import type { Context, ObjectId } from "hydrooj";
import { OplogModel, param, Types, UserModel, ValidationError } from "hydrooj";

import type { ReviewDecision } from "./constants";
import {
    BLOG_REPORT_RATE_LIMIT,
    BlogAuditEvents,
    BlogPermissions,
    REVIEW_PAGE_SIZE,
    ReviewDecisions,
    ReviewMessages,
    ROUTE_BLOG_LIST_HOME,
    ROUTE_BLOG_POST_DETAIL,
    ROUTE_BLOG_REPORT,
    ROUTE_BLOG_REVIEW,
    ROUTE_BLOG_REVIEW_DETAIL,
    ROUTE_BLOG_REVIEW_RESET,
    SYSTEM_DOMAIN,
} from "./constants";
import { BlogBaseHandler, BlogUserPostBaseHandler } from "./handler.base";
import { sendBlogMessage } from "./notifications";
import { articleForResponse, BlogReviewModel, OptionalReviewComment } from "./review.model";
import { BlogSettingsModel } from "./settings.model";
import type { BlogDoc } from "./types";
import { toTemplate } from "./utils";

class BlogReviewListHandler extends BlogBaseHandler {
    prepare() {
        this.blog.requireLogin();
        this.blog.require(BlogPermissions.REVIEW);
    }

    @param("page", Types.PositiveInt, true)
    async get(_, page = 1) {
        const [ddocs, dpcount] = await this.ctx.db.paginate(BlogReviewModel.pending(), page, REVIEW_PAGE_SIZE);
        const udict = await UserModel.getList(
            SYSTEM_DOMAIN,
            ddocs.map((doc) => doc.owner),
        );
        this.response.template = toTemplate(ROUTE_BLOG_REVIEW);
        this.response.body = {
            ddocs: ddocs.map(articleForResponse),
            dpcount,
            page,
            udict,
            pendingCount: await BlogReviewModel.count(),
        };
    }
}

class BlogReviewTargetHandler extends BlogBaseHandler {
    ddoc!: BlogDoc;

    @param("did", Types.ObjectId)
    async _prepare(_, did: ObjectId) {
        this.ddoc = await BlogReviewModel.get(did);
    }

    post() {
        this.blog.requireLogin();
    }
}

class BlogReviewDetailHandler extends BlogReviewTargetHandler {
    prepare() {
        this.blog.requireLogin();
        this.blog.require(BlogPermissions.REVIEW);
    }

    @param("page", Types.PositiveInt, true)
    async get(_, page = 1) {
        const doc = await BlogReviewModel.settle(this.ddoc);
        if (!doc.reviewPending || doc.pendingReportWrite) {
            throw new ValidationError("review", null, ReviewMessages.Changed);
        }
        const [reports, dpcount] = await this.ctx.db.paginate(
            BlogReviewModel.reports.find({ articleId: doc.docId }).sort({ acceptedAt: -1, _id: 1 }),
            page,
            REVIEW_PAGE_SIZE,
        );
        this.response.template = toTemplate(ROUTE_BLOG_REVIEW_DETAIL);
        this.response.body = {
            ddoc: articleForResponse(doc),
            reports,
            page,
            dpcount,
            udict: await UserModel.getList(SYSTEM_DOMAIN, [doc.owner, ...reports.map((r) => r.reporter)]),
            canReset: this.blog.canResetReview(),
        };
    }

    @param("generation", Types.UnsignedInt)
    @param("version", Types.UnsignedInt)
    @param("decision", Types.Range(Object.values(ReviewDecisions)))
    @param("comments", OptionalReviewComment, true)
    async postDecide(_, generation: number, version: number, decision: ReviewDecision, comments = "") {
        const next = await BlogReviewModel.decide(this.ddoc, generation, version, decision, this.user._id, comments);
        await OplogModel.log(this, BlogAuditEvents.Review, {
            ...BlogReviewModel.audit(next),
            previous: BlogReviewModel.audit(this.ddoc),
            decision,
            comments,
        });
        const link = this.url(ROUTE_BLOG_POST_DETAIL, { uid: next.owner, did: next.docId, domainId: SYSTEM_DOMAIN });
        await sendBlogMessage(
            this.ctx,
            next.owner,
            decision === ReviewDecisions.Approve ? ReviewMessages.ApprovedNotice : ReviewMessages.RejectedNotice,
            decision === ReviewDecisions.Approve ? [next.title, version, link] : [next.title, version, comments, link],
        );
        this.response.body = { did: next.docId, decision };
        this.response.redirect = this.url(ROUTE_BLOG_REVIEW);
    }
}

class BlogReviewResetHandler extends BlogReviewTargetHandler {
    prepare() {
        this.blog.requireLogin();
        this.blog.require(BlogPermissions.RESET_REVIEW_COUNTERS);
    }

    get() {
        this.response.template = toTemplate(ROUTE_BLOG_REVIEW_RESET);
        this.response.body = {
            did: this.ddoc.docId,
            revision: this.ddoc.writeRevision ?? 0,
            ...(this.blog.canReview() ? { reportCount: this.ddoc.reportCount ?? 0 } : {}),
            canViewReportCount: this.blog.canReview(),
            rejectionCount: this.ddoc.rejectionCount ?? 0,
        };
    }

    @param("revision", Types.UnsignedInt)
    async postResetReview(_, revision: number) {
        const next = await BlogReviewModel.reset(this.ddoc, revision);
        await OplogModel.log(this, BlogAuditEvents.ResetReview, {
            ...BlogReviewModel.audit(next),
            previous: BlogReviewModel.audit(this.ddoc),
        });
        this.back();
    }
}

class BlogReportHandler extends BlogUserPostBaseHandler {
    post() {
        this.blog.requireLogin();
    }

    @param("version", Types.UnsignedInt)
    @param("comments", OptionalReviewComment, true)
    async postReport(_, version: number, comments = "") {
        const ownReceipt = await BlogReviewModel.reports.findOne({
            _id: BlogReviewModel.reportId(this.ddoc.docId, version, this.user._id),
        });
        const ownPending =
            this.ddoc.pendingReportWrite?.reporter === this.user._id &&
            this.ddoc.pendingReportWrite.version === version;
        if (!ownReceipt && !ownPending) this.requireRead();
        await this.limitRate(
            BLOG_REPORT_RATE_LIMIT.Operation,
            BLOG_REPORT_RATE_LIMIT.PeriodSeconds,
            BLOG_REPORT_RATE_LIMIT.MaxOperations,
        );
        const result = await BlogReviewModel.report(
            this.ddoc,
            this.user._id,
            version,
            comments,
            await BlogSettingsModel.review(),
        );
        if (!result.duplicate) {
            await OplogModel.log(this, BlogAuditEvents.Report, {
                ...BlogReviewModel.audit(result.doc),
                previous: BlogReviewModel.audit(this.ddoc),
                comments,
                hidden: result.hidden,
            });
            if (result.hidden) {
                await sendBlogMessage(this.ctx, result.doc.owner, ReviewMessages.HiddenNotice, [
                    result.doc.title,
                    version,
                    this.url(ROUTE_BLOG_POST_DETAIL, {
                        uid: result.doc.owner,
                        did: result.doc.docId,
                        domainId: SYSTEM_DOMAIN,
                    }),
                ]);
            }
        }
        this.response.body = { reported: true, duplicate: result.duplicate };
        this.response.redirect = this.url(ROUTE_BLOG_LIST_HOME);
    }
}

export function applyReviewHandler(ctx: Context) {
    ctx.Route(ROUTE_BLOG_REVIEW, "/blog/review", BlogReviewListHandler);
    ctx.Route(ROUTE_BLOG_REVIEW_RESET, "/blog/review/:did/reset", BlogReviewResetHandler);
    ctx.Route(ROUTE_BLOG_REVIEW_DETAIL, "/blog/review/:did", BlogReviewDetailHandler);
    ctx.Route(ROUTE_BLOG_REPORT, "/blog/:uid/:did/report", BlogReportHandler);
}
