import type { Context, Filter, NumberKeys, ObjectId } from "hydrooj";
import { DocumentModel, ValidationError } from "hydrooj";

import { BlogCommentModel } from "../comments/comment.model";
import { BlogReviewModel } from "../review/review.model";
import { publicationUpdate } from "../review/review.policy";
import { BlogMessages, SYSTEM_DOMAIN, TYPE_BLOG } from "../shared/constants";
import { DEFAULT_REVIEW_SETTINGS, ReviewModes, ReviewReasons } from "../shared/constants";
import type { BlogDoc, BlogReviewSettings, BlogStatusDoc, BlogUpdate } from "../shared/types";

export { TYPE_BLOG } from "../shared/constants";

declare module "hydrooj" {
    interface Model {
        blog: typeof BlogModel;
    }
    interface DocType {
        [TYPE_BLOG]: BlogDoc;
    }

    interface DocStatusType {
        [TYPE_BLOG]: BlogStatusDoc;
    }
}

export class BlogModel {
    static async init(ctx: Context) {
        // The document collection is shared across all docTypes; restrict every index to blog docs only.
        const partialFilterExpression: Filter<BlogDoc> = {
            domainId: SYSTEM_DOMAIN,
            docType: TYPE_BLOG,
        };

        await ctx.db.ensureIndexes(
            DocumentModel.coll,
            // Home list: no owner filter; sort by a single key.
            // draft is queried as an inequality (e.g. {$ne: true}), so keep it trailing in the compound index.
            {
                key: { views: -1, draft: 1 },
                name: "blogHomeByViews",
                partialFilterExpression,
            },
            {
                key: { firstPublishAt: -1, draft: 1 },
                name: "blogHomeByFirstPublish",
                partialFilterExpression,
            },
            {
                key: { updateAt: -1, draft: 1 },
                name: "blogHomeByUpdateAt",
                partialFilterExpression,
            },
            // User list: owner equality, pin then sort key.
            // draft is queried as an inequality (e.g. {$ne: true}), so keep it trailing in the compound index.
            {
                key: { owner: 1, pin: -1, views: -1, draft: 1 },
                name: "blogUserByViews",
                partialFilterExpression,
            },
            {
                key: { owner: 1, pin: -1, firstPublishAt: -1, draft: 1 },
                name: "blogUserByFirstPublish",
                partialFilterExpression,
            },
            {
                key: { owner: 1, pin: -1, updateAt: -1, draft: 1 },
                name: "blogUserByUpdateAt",
                partialFilterExpression,
            },
        );
    }

    static async add(
        owner: number,
        title: string,
        content: string,
        draft: boolean,
        pin: boolean,
        ip: string,
        settings: BlogReviewSettings = DEFAULT_REVIEW_SETTINGS,
    ): Promise<ObjectId> {
        const ddoc: Partial<BlogDoc> = {
            title,
            draft,
            pin,
            ip,
            nReply: 0,
            updateAt: new Date(),
            views: 0,
        };

        if (!draft && settings.mode === ReviewModes.Before) {
            Object.assign(ddoc, {
                draft: true,
                requiresReview: true,
                reviewPending: true,
                reviewReason: ReviewReasons.Publication,
                reviewGeneration: 1,
                reviewQueuedAt: ddoc.updateAt,
            });
        } else if (!draft) {
            ddoc.firstPublishAt = ddoc.updateAt;
        }

        return await DocumentModel.add(
            SYSTEM_DOMAIN,
            content,
            owner,
            TYPE_BLOG,
            null /* docId */,
            null /* parentType */,
            null /* parentId */,
            ddoc,
        );
    }

    static async get(did: ObjectId): Promise<BlogDoc | null> {
        const ddoc = (await DocumentModel.get(SYSTEM_DOMAIN, TYPE_BLOG, did)) as BlogDoc | null;

        // For the backward compatibility, if the firstPublishAt is not set, we set it to updateAt.
        if (ddoc && !ddoc.draft && !ddoc.firstPublishAt) {
            ddoc.firstPublishAt = ddoc.updateAt;
        }

        return ddoc;
    }

    static async edit(
        ddoc: BlogDoc,
        update: BlogUpdate,
        _checked = true,
        settings: BlogReviewSettings = DEFAULT_REVIEW_SETTINGS,
        withdraw = false,
    ): Promise<BlogDoc> {
        ddoc = await BlogReviewModel.settle(ddoc);
        return BlogReviewModel.change(ddoc, publicationUpdate(ddoc, update, settings, withdraw));
    }

    static async inc(did: ObjectId, key: NumberKeys<BlogDoc>, value: number): Promise<BlogDoc> {
        return (await DocumentModel.inc(SYSTEM_DOMAIN, TYPE_BLOG, did, key, value)) as BlogDoc;
    }

    static async del(did: ObjectId): Promise<never> {
        const doc = await this.get(did);
        if (doc) await this.deleteChecked(doc);
        else await this.cleanup(did);
        return undefined as never;
    }

    static async cleanup(did: ObjectId) {
        const cleanup = await Promise.all([
            DocumentModel.deleteMultiStatus(SYSTEM_DOMAIN, TYPE_BLOG, { docId: did }),
            BlogCommentModel.deleteForArticle(did),
            BlogReviewModel.reports.deleteMany({ articleId: did }),
        ]);
        return cleanup;
    }

    static async deleteChecked(ddoc: BlogDoc) {
        ddoc = await BlogReviewModel.settle(ddoc);
        const result = await DocumentModel.coll.deleteOne(BlogReviewModel.predicate(ddoc));
        if (!result.deletedCount) throw new ValidationError("post", null, BlogMessages.ArticleChanged);
        await this.cleanup(ddoc.docId);
    }

    static async count(query: Filter<BlogDoc>) {
        return await DocumentModel.count(SYSTEM_DOMAIN, TYPE_BLOG, query);
    }

    static getMulti(query: Filter<BlogDoc> = {}) {
        return DocumentModel.getMulti(SYSTEM_DOMAIN, TYPE_BLOG, query)
            .project<BlogDoc>({ pendingReportWrite: 0, lastReview: 0 })
            .sort({ _id: -1 });
    }

    static async addReply(did: ObjectId, owner: number, content: string, ip: string): Promise<ObjectId> {
        return BlogCommentModel.add(did, owner, content, ip);
    }

    static async setStar(did: ObjectId, uid: number, star: boolean): Promise<void> {
        await this.setStatus(did, uid, { star });
    }

    static async getStatus(did: ObjectId, uid: number): Promise<BlogStatusDoc> {
        return (await DocumentModel.getStatus(SYSTEM_DOMAIN, TYPE_BLOG, did, uid)) as BlogStatusDoc;
    }

    static async setStatus(
        did: ObjectId,
        uid: number,
        $set: Omit<BlogStatusDoc, "docType" | "docId">,
    ): Promise<BlogStatusDoc> {
        return (await DocumentModel.setStatus(SYSTEM_DOMAIN, TYPE_BLOG, did, uid, $set)) as BlogStatusDoc;
    }
}

global.Hydro.model.blog = BlogModel;
