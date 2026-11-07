import { randomUUID } from "node:crypto";

import type { Context, Filter, ObjectId } from "hydrooj";
import { DocumentModel, DocumentNotFoundError, ValidationError } from "hydrooj";
import type { Collection } from "mongodb";

import type { ReviewDecision } from "./constants";
import {
    BlogCollections,
    BlogMessages,
    REVIEW_BATCH_SIZE,
    REVIEW_COMMENT_MAX,
    REVIEW_DISABLE_ATTEMPTS,
    ReviewDecisions,
    ReviewMessages,
    ReviewModes,
    ReviewReasons,
    SYSTEM_DOMAIN,
    TYPE_BLOG,
} from "./constants";
import type { BlogDoc, BlogReport, BlogReviewSettings, BlogUpdate } from "./types";

declare module "hydrooj" {
    interface Collections {
        [BlogCollections.Reports]: BlogReport;
    }
}

export function reviewComment(value: unknown): string {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value !== "string" || value.trim().length > REVIEW_COMMENT_MAX) {
        throw new ValidationError("comments");
    }
    return value.trim();
}

export const OptionalReviewComment = [reviewComment, () => true] as const;

export function articleForResponse(doc: BlogDoc): BlogDoc {
    const result = { ...doc };
    delete result.ip;
    if (doc.reply) {
        result.reply = doc.reply.map((reply) => {
            const visible = { ...reply };
            delete visible.ip;
            return visible;
        });
    }
    return result;
}

export function articleForReader(doc: BlogDoc, uid: number, canReview = false): BlogDoc {
    const result = { ...doc };
    delete result.pendingReportWrite;
    delete result.rejectionCount;
    if (doc.owner !== uid) {
        delete result.writeRevision;
        delete result.contentVersion;
        delete result.counterEpoch;
        delete result.requiresReview;
        delete result.reviewReason;
        delete result.reviewPending;
        delete result.reviewGeneration;
        delete result.reviewQueuedAt;
        delete result.reportApprovedVersion;
        delete result.lastReview;
    }
    if (!canReview) delete result.reportCount;
    return result;
}

export function publicationUpdate(
    doc: BlogDoc,
    update: BlogUpdate,
    settings: BlogReviewSettings,
    withdraw = false,
): Partial<BlogDoc> {
    const result: Partial<BlogDoc> = { ...update };
    const changed =
        (update.title !== undefined && update.title !== doc.title) ||
        (update.content !== undefined && update.content !== doc.content);
    if (changed) result.contentVersion = (doc.contentVersion ?? 0) + 1;
    if (withdraw) {
        result.draft = true;
        result.reviewPending = false;
        result.reviewGeneration = (doc.reviewGeneration ?? 0) + 1;
        return result;
    }
    const publishing = update.draft === false && (!!doc.draft || changed);
    if (publishing && (doc.rejectionCount ?? 0) >= settings.rejectionLimit) {
        throw new ValidationError("post", null, ReviewMessages.Blocked);
    }
    if (publishing && (settings.mode === ReviewModes.Before || (doc.requiresReview && doc.draft))) {
        result.draft = true;
        result.requiresReview = true;
        result.reviewPending = true;
        result.reviewReason = doc.requiresReview
            ? (doc.reviewReason ?? ReviewReasons.Publication)
            : ReviewReasons.Publication;
        result.reviewQueuedAt = doc.reviewPending ? doc.reviewQueuedAt : new Date();
    }
    if ((changed && doc.reviewPending) || result.reviewPending) {
        result.reviewGeneration = (doc.reviewGeneration ?? 0) + 1;
    }
    return result;
}

export class BlogReviewModel {
    static reports: Collection<BlogReport>;

    static async init(ctx: Context) {
        this.reports = ctx.db.collection(BlogCollections.Reports);
        await ctx.db.ensureIndexes(this.reports, {
            key: { articleId: 1, acceptedAt: -1, _id: 1 },
            name: "blogReportsByArticle",
        });
        const partialFilterExpression = { domainId: SYSTEM_DOMAIN, docType: TYPE_BLOG };
        await ctx.db.ensureIndexes(
            DocumentModel.coll,
            {
                key: { reviewPending: 1, reviewQueuedAt: 1, docId: 1 },
                name: "blogReviewQueue",
                partialFilterExpression,
            },
            {
                key: { docId: 1 },
                name: "blogPendingReportWrites",
                partialFilterExpression: { ...partialFilterExpression, pendingReportWrite: { $exists: true } },
            },
        );
    }

    static async get(did: ObjectId): Promise<BlogDoc> {
        const doc = (await DocumentModel.get(SYSTEM_DOMAIN, TYPE_BLOG, did)) as BlogDoc | null;
        if (!doc) throw new DocumentNotFoundError(SYSTEM_DOMAIN, did);
        return doc;
    }

    static predicate(doc: BlogDoc): Filter<BlogDoc> {
        return {
            domainId: SYSTEM_DOMAIN,
            docType: TYPE_BLOG,
            docId: doc.docId,
            updateAt: doc.updateAt,
            draft: doc.draft ? true : { $ne: true },
            writeRevision: doc.writeRevision ?? { $exists: false },
            pendingReportWrite: { $exists: false },
        };
    }

    static async change(doc: BlogDoc, update: Partial<BlogDoc>): Promise<BlogDoc> {
        const firstPublishAt = doc.firstPublishAt ?? (!doc.draft ? doc.updateAt : undefined);
        const $set = {
            ...update,
            ...(firstPublishAt ? { firstPublishAt } : {}),
            writeRevision: (doc.writeRevision ?? 0) + 1,
            updateAt: new Date(Math.max(Date.now(), doc.updateAt.getTime() + 1)),
        };
        if ($set.draft === false && !firstPublishAt) $set.firstPublishAt = $set.updateAt;
        const result: unknown = await DocumentModel.coll.findOneAndUpdate(
            this.predicate(doc),
            { $set },
            { returnDocument: "after" },
        );
        if (!result) throw new ValidationError("post", null, BlogMessages.ArticleChanged);
        return result as BlogDoc;
    }

    static async materialize(doc: BlogDoc): Promise<void> {
        const receipt = doc.pendingReportWrite;
        if (!receipt) return;
        await this.reports.updateOne({ _id: receipt._id }, { $setOnInsert: receipt }, { upsert: true });
        const stored = await this.reports.findOne({ _id: receipt._id });
        if (
            !stored ||
            stored.operationId !== receipt.operationId ||
            stored.comments !== receipt.comments ||
            stored.revision !== receipt.revision
        ) {
            throw new ValidationError("report", null, ReviewMessages.Integrity);
        }
        const parent: unknown = await DocumentModel.get(SYSTEM_DOMAIN, TYPE_BLOG, doc.docId);
        if (!parent) {
            await this.reports.deleteOne({ _id: receipt._id, operationId: receipt.operationId });
            throw new DocumentNotFoundError(SYSTEM_DOMAIN, doc.docId);
        }
        await DocumentModel.coll.updateOne(
            {
                domainId: SYSTEM_DOMAIN,
                docType: TYPE_BLOG,
                docId: doc.docId,
                "pendingReportWrite.operationId": receipt.operationId,
            },
            { $unset: { pendingReportWrite: "" }, $inc: { writeRevision: 1 } },
        );
    }

    static async settle(doc: BlogDoc): Promise<BlogDoc> {
        const receipt = doc.pendingReportWrite;
        if (!receipt) return doc;
        await this.materialize(doc);
        const next = await this.get(doc.docId);
        if (next.writeRevision !== receipt.revision + 1) {
            throw new ValidationError("post", null, BlogMessages.ArticleChanged);
        }
        return next;
    }

    static reportId(did: ObjectId, version: number, uid: number) {
        return `${SYSTEM_DOMAIN}:${TYPE_BLOG}:${did.toHexString()}:${version}:${uid}`;
    }

    static async report(doc: BlogDoc, uid: number, version: number, comments: string, settings: BlogReviewSettings) {
        doc = await this.settle(doc);
        const id = this.reportId(doc.docId, version, uid);
        if (await this.reports.findOne({ _id: id })) return { doc, duplicate: true, hidden: false };
        if (
            doc.draft ||
            doc.owner === uid ||
            settings.mode === ReviewModes.Disabled ||
            version !== (doc.contentVersion ?? 0) ||
            doc.reportApprovedVersion === version
        ) {
            throw new ValidationError("report", null, ReviewMessages.Unavailable);
        }
        const count = (doc.reportCount ?? 0) + 1;
        if (!Number.isSafeInteger(count)) throw new ValidationError("report");
        const receipt: BlogReport = {
            _id: id,
            articleId: doc.docId,
            reporter: uid,
            version,
            comments: reviewComment(comments),
            acceptedAt: new Date(),
            epoch: doc.counterEpoch ?? 0,
            operationId: randomUUID(),
            revision: (doc.writeRevision ?? 0) + 1,
        };
        const hidden = count > settings.reportLimit;
        const next = await this.change(doc, {
            reportCount: count,
            draft: hidden,
            requiresReview: true,
            reviewReason: ReviewReasons.Report,
            reviewPending: true,
            reviewQueuedAt: doc.reviewPending ? doc.reviewQueuedAt : receipt.acceptedAt,
            reviewGeneration: (doc.reviewGeneration ?? 0) + 1,
            pendingReportWrite: receipt,
        });
        await this.materialize(next);
        return { doc: next, duplicate: false, hidden };
    }

    static async decide(
        doc: BlogDoc,
        generation: number,
        version: number,
        decision: ReviewDecision,
        uid: number,
        comments: string,
    ) {
        doc = await this.settle(doc);
        if (
            !doc.reviewPending ||
            (doc.reviewGeneration ?? 0) !== generation ||
            (doc.contentVersion ?? 0) !== version ||
            !Object.values(ReviewDecisions).includes(decision)
        ) {
            throw new ValidationError("review", null, ReviewMessages.Changed);
        }
        const approve = decision === ReviewDecisions.Approve;
        const rejections = (doc.rejectionCount ?? 0) + 1;
        if (!Number.isSafeInteger(rejections)) throw new ValidationError("review");
        return this.change(doc, {
            draft: !approve,
            reviewPending: false,
            reviewGeneration: generation + 1,
            requiresReview: !approve,
            rejectionCount: approve ? 0 : rejections,
            ...(approve ? { reportCount: 0, counterEpoch: (doc.counterEpoch ?? 0) + 1 } : {}),
            ...(approve && doc.reviewReason === ReviewReasons.Report ? { reportApprovedVersion: version } : {}),
            lastReview: { decision, reviewer: uid, comments: reviewComment(comments), at: new Date(), version },
        });
    }

    static async reset(doc: BlogDoc, revision: number) {
        const expected = doc.writeRevision ?? 0;
        doc = await this.settle(doc);
        if (revision !== expected) throw new ValidationError("review", null, ReviewMessages.Changed);
        return this.change(doc, {
            reportCount: 0,
            rejectionCount: 0,
            counterEpoch: (doc.counterEpoch ?? 0) + 1,
            reviewGeneration: (doc.reviewGeneration ?? 0) + 1,
        });
    }

    static async approvePending(
        uid: number,
        cutoff: Date,
        onApproved: (previous: BlogDoc, next: BlogDoc) => Promise<void>,
    ) {
        const queued: Filter<BlogDoc> = {
            reviewPending: true,
            $or: [{ reviewQueuedAt: { $lte: cutoff } }, { reviewQueuedAt: { $exists: false } }],
        };
        const [last] = await DocumentModel.getMulti(SYSTEM_DOMAIN, TYPE_BLOG, queued)
            .sort({ docId: -1 })
            .limit(1)
            .toArray();
        if (!last) return 0;
        let after: ObjectId | undefined;
        let approved = 0;
        while (true) {
            const docs = await DocumentModel.getMulti(SYSTEM_DOMAIN, TYPE_BLOG, {
                ...queued,
                docId: { $lte: last.docId, ...(after ? { $gt: after } : {}) },
            })
                .sort({ docId: 1 })
                .limit(REVIEW_BATCH_SIZE)
                .toArray();
            if (!docs.length) return approved;
            for (const entry of docs) {
                for (let attempt = 0; attempt < REVIEW_DISABLE_ATTEMPTS; attempt++) {
                    const doc = (await DocumentModel.get(SYSTEM_DOMAIN, TYPE_BLOG, entry.docId)) as BlogDoc | null;
                    if (!doc?.reviewPending || (doc.reviewQueuedAt && doc.reviewQueuedAt > cutoff)) break;
                    let next: BlogDoc;
                    try {
                        next = await this.decide(
                            doc,
                            doc.reviewGeneration ?? 0,
                            doc.contentVersion ?? 0,
                            ReviewDecisions.Approve,
                            uid,
                            "",
                        );
                    } catch (error) {
                        if (error instanceof DocumentNotFoundError) break;
                        const conflict =
                            error instanceof ValidationError &&
                            (error.params[2] === BlogMessages.ArticleChanged ||
                                error.params[2] === ReviewMessages.Changed);
                        if (conflict && attempt + 1 < REVIEW_DISABLE_ATTEMPTS) continue;
                        throw error;
                    }
                    await onApproved(doc, next);
                    approved++;
                    break;
                }
            }
            after = docs[docs.length - 1].docId;
        }
    }

    static pending() {
        return DocumentModel.getMulti(SYSTEM_DOMAIN, TYPE_BLOG, { reviewPending: true })
            .project<BlogDoc>({ pendingReportWrite: 0, lastReview: 0 })
            .sort({ reviewQueuedAt: 1, docId: 1 });
    }

    static count() {
        return DocumentModel.count(SYSTEM_DOMAIN, TYPE_BLOG, { reviewPending: true });
    }

    static audit(doc: BlogDoc) {
        return {
            articleDomainId: SYSTEM_DOMAIN,
            did: doc.docId,
            version: doc.contentVersion ?? 0,
            generation: doc.reviewGeneration ?? 0,
            reason: doc.reviewReason,
            draft: !!doc.draft,
            reportCount: doc.reportCount ?? 0,
            rejectionCount: doc.rejectionCount ?? 0,
        };
    }
}
