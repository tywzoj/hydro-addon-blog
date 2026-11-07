import type { Context } from "hydrooj";
import type { Collection } from "mongodb";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    BLOG_PERM,
    DEFAULT_REVIEW_SETTINGS,
    ReviewDecisions,
    ReviewModes,
    ReviewReasons,
} from "../../features/constants";
import { BlogModel } from "../../features/model";
import { BlogPolicy } from "../../features/permission";
import { applyReviewHandler } from "../../features/review.handler";
import { articleForReader, BlogReviewModel, publicationUpdate, reviewComment } from "../../features/review.model";
import type { BlogDoc, BlogReport } from "../../features/types";
import { makeBlog } from "../helpers/fixtures";
import type { Handler } from "../helpers/hydro";
import { dispatchHandler, DocumentModel, makeUser, MessageModel, OplogModel, ValidationError } from "../helpers/hydro";

let article: BlogDoc | null;
const receipts = new Map<string, BlogReport>();
const reports = {
    findOne: vi.fn(),
    updateOne: vi.fn(),
    deleteOne: vi.fn(),
    deleteMany: vi.fn(),
};
const after = { ...DEFAULT_REVIEW_SETTINGS, mode: ReviewModes.After };
const before = { ...DEFAULT_REVIEW_SETTINGS, mode: ReviewModes.Before };
const snapshot = () => ({ ...article! });

beforeEach(() => {
    vi.resetAllMocks();
    receipts.clear();
    article = makeBlog({ draft: false, firstPublishAt: new Date("2026-01-02") });
    BlogReviewModel.reports = reports as unknown as Collection<BlogReport>;
    reports.findOne.mockImplementation(({ _id }: { _id: string }) => Promise.resolve(receipts.get(_id) ?? null));
    reports.updateOne.mockImplementation(({ _id }: { _id: string }, update: { $setOnInsert: BlogReport }) => {
        if (!receipts.has(_id)) receipts.set(_id, update.$setOnInsert);
        return Promise.resolve({ matchedCount: 1 });
    });
    reports.deleteOne.mockImplementation(({ _id }: { _id: string }) => {
        receipts.delete(_id);
        return Promise.resolve({ deletedCount: 1 });
    });
    DocumentModel.get.mockImplementation(() => Promise.resolve(article ? snapshot() : null));
    DocumentModel.coll.findOneAndUpdate.mockImplementation((rawFilter, rawUpdate) => {
        const filter = rawFilter as { writeRevision: number | { $exists: boolean }; updateAt: Date };
        const update = rawUpdate as { $set: Partial<BlogDoc> };
        const revision = typeof filter.writeRevision === "number" ? filter.writeRevision : undefined;
        if (
            !article ||
            article.pendingReportWrite ||
            article.writeRevision !== revision ||
            article.updateAt.getTime() !== filter.updateAt.getTime()
        ) {
            return Promise.resolve(null);
        }
        article = { ...article, ...update.$set };
        return Promise.resolve(snapshot());
    });
    DocumentModel.coll.updateOne.mockImplementation((filter: Record<string, unknown>) => {
        if (!article || article.pendingReportWrite?.operationId !== filter["pendingReportWrite.operationId"]) {
            return Promise.resolve({ matchedCount: 0 });
        }
        delete article.pendingReportWrite;
        article.writeRevision = (article.writeRevision ?? 0) + 1;
        return Promise.resolve({ matchedCount: 1 });
    });
});

describe("approval when disabling review", () => {
    function queueOnce() {
        const cursor = { sort: vi.fn(), project: vi.fn(), limit: vi.fn(), toArray: vi.fn() };
        cursor.sort.mockReturnValue(cursor);
        cursor.project.mockReturnValue(cursor);
        cursor.limit.mockReturnValue(cursor);
        cursor.toArray.mockResolvedValueOnce([snapshot()]).mockResolvedValueOnce([snapshot()]).mockResolvedValue([]);
        DocumentModel.getMulti.mockReturnValue(cursor);
        return cursor;
    }

    it("continues beyond the first batch with a stable article-ID cursor", async () => {
        const docs = Array.from({ length: 101 }, () => makeBlog({ docId: new ObjectId(), reviewPending: true }));
        const cursor = { sort: vi.fn(), project: vi.fn(), limit: vi.fn(), toArray: vi.fn() };
        cursor.sort.mockReturnValue(cursor);
        cursor.project.mockReturnValue(cursor);
        cursor.limit.mockReturnValue(cursor);
        cursor.toArray
            .mockResolvedValueOnce([docs[100]])
            .mockResolvedValueOnce(docs.slice(0, 100))
            .mockResolvedValueOnce([docs[100]])
            .mockResolvedValueOnce([]);
        DocumentModel.getMulti.mockReturnValue(cursor);
        DocumentModel.get.mockImplementation((_domain, _type, id) =>
            Promise.resolve(docs.find((doc) => doc.docId.equals(id as ObjectId)) ?? null),
        );
        vi.spyOn(BlogReviewModel, "decide").mockImplementation((doc) =>
            Promise.resolve({ ...doc, draft: false, reviewPending: false }),
        );
        const notify = vi.fn();
        expect(await BlogReviewModel.approvePending(9, notify)).toBe(101);
        expect(notify).toHaveBeenCalledTimes(101);
        expect(DocumentModel.getMulti.mock.calls[2][2]).toMatchObject({
            docId: { $gt: docs[99].docId, $lte: docs[100].docId },
        });
    });

    it("settles accepted reports and applies normal approval before emitting side effects", async () => {
        reports.updateOne.mockRejectedValueOnce(new Error("receipt unavailable"));
        await expect(BlogReviewModel.report(snapshot(), 3, 0, "Report", after)).rejects.toThrow();
        queueOnce();
        const notify = vi.fn((_previous: BlogDoc, next: BlogDoc) => {
            expect(next).toMatchObject({
                draft: false,
                reviewPending: false,
                reportCount: 0,
                rejectionCount: 0,
                reportApprovedVersion: 0,
            });
            return Promise.resolve();
        });
        expect(await BlogReviewModel.approvePending(9, notify)).toBe(1);
        expect(notify).toHaveBeenCalledOnce();
        expect(receipts.size).toBe(1);
        expect(article?.lastReview?.reviewer).toBe(9);
    });

    it("does not override a manual rejection that wins the conditional write", async () => {
        article = makeBlog({ reviewPending: true, requiresReview: true, reviewReason: ReviewReasons.Publication });
        queueOnce();
        const notify = vi.fn();
        await Promise.all([
            BlogReviewModel.approvePending(9, notify),
            BlogReviewModel.decide(snapshot(), 0, 0, ReviewDecisions.Reject, 8, "Rejected first"),
        ]);
        expect(article).toMatchObject({ draft: true, reviewPending: false, rejectionCount: 1 });
        expect(notify).not.toHaveBeenCalled();
    });

    it("does not approve an article newly requeued after the sweep started", async () => {
        article = makeBlog({ reviewPending: true, requiresReview: true });
        queueOnce();
        article.reviewQueuedAt = new Date(Date.now() + 60_000);
        const notify = vi.fn();
        expect(await BlogReviewModel.approvePending(9, notify)).toBe(0);
        expect(article.reviewPending).toBe(true);
        expect(notify).not.toHaveBeenCalled();
        expect(DocumentModel.coll.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("reloads edited pending content after a conflict and bounds repeated conflicts", async () => {
        article = makeBlog({ reviewPending: true, requiresReview: true });
        queueOnce();
        DocumentModel.coll.findOneAndUpdate.mockImplementationOnce(() => {
            article = { ...article!, contentVersion: 1, reviewGeneration: 1, writeRevision: 1 };
            return Promise.resolve(null);
        });
        const notify = vi.fn();
        expect(await BlogReviewModel.approvePending(9, notify)).toBe(1);
        expect(article?.lastReview?.version).toBe(1);
        expect(notify).toHaveBeenCalledOnce();

        article = makeBlog({ reviewPending: true, requiresReview: true });
        queueOnce();
        DocumentModel.coll.findOneAndUpdate.mockClear().mockResolvedValue(null);
        await expect(BlogReviewModel.approvePending(9, notify)).rejects.toBeInstanceOf(ValidationError);
        expect(DocumentModel.coll.findOneAndUpdate).toHaveBeenCalledTimes(3);
    });

    it("propagates delivery failure without applying the same approval again on retry", async () => {
        article = makeBlog({ reviewPending: true, requiresReview: true });
        queueOnce();
        const notify = vi.fn().mockRejectedValue(new Error("notice failed"));
        await expect(BlogReviewModel.approvePending(9, notify)).rejects.toThrow("notice failed");
        expect(article?.reviewPending).toBe(false);
        queueOnce();
        expect(await BlogReviewModel.approvePending(9, notify)).toBe(0);
        expect(notify).toHaveBeenCalledOnce();
    });
});

describe("review publication state machine", () => {
    it("queues pre-publication creation without a first publication timestamp", async () => {
        await BlogModel.add(1, "Title", "Content", false, false, "192.0.2.1", before);
        expect(DocumentModel.add.mock.calls[0][7]).toMatchObject({
            draft: true,
            reviewPending: true,
            requiresReview: true,
            reviewReason: "publication",
        });
        expect(DocumentModel.add.mock.calls[0][7]).not.toHaveProperty("firstPublishAt");
    });

    it.each([ReviewModes.Disabled, ReviewModes.After])("publishes an unrestricted draft in %s mode", (mode) => {
        expect(publicationUpdate(makeBlog(), { draft: false }, { ...after, mode })).toEqual({ draft: false });
    });

    it("requeues public edits before publication but leaves post-publication edits public", () => {
        const update = { draft: false, content: "Changed" };
        expect(publicationUpdate(snapshot(), update, before)).toMatchObject({
            draft: true,
            contentVersion: 1,
            reviewPending: true,
            requiresReview: true,
        });
        expect(publicationUpdate(snapshot(), update, after)).toEqual({ ...update, contentVersion: 1 });
    });

    it("preserves pending edits and report origin; only explicit withdrawal removes the queue", () => {
        const doc = makeBlog({ requiresReview: true, reviewPending: true, reviewReason: ReviewReasons.Report });
        expect(publicationUpdate(doc, { content: "New", draft: true }, before)).toMatchObject({
            contentVersion: 1,
            reviewGeneration: 1,
        });
        expect(publicationUpdate(doc, { content: "New", draft: true }, before)).not.toHaveProperty("reviewPending");
        expect(publicationUpdate(doc, { draft: false }, before)).toMatchObject({ reviewReason: "report", draft: true });
        expect(publicationUpdate(doc, { draft: true }, after, true)).toMatchObject({ reviewPending: false });
    });

    it("blocks resubmission at the rejection limit even when review is disabled", () => {
        const doc = makeBlog({ requiresReview: true, rejectionCount: 3 });
        expect(() => publicationUpdate(doc, { draft: false }, DEFAULT_REVIEW_SETTINGS)).toThrow(ValidationError);
        expect(publicationUpdate(doc, { content: "Still editable" }, after)).toMatchObject({ contentVersion: 1 });
    });

    it("keeps a legacy first-publication fallback when reporting hides the article", async () => {
        article = makeBlog({ draft: false });
        const doc = (await BlogModel.get(article.docId))!;
        await BlogReviewModel.report(doc, 3, 0, "", { ...after, reportLimit: 0 });
        expect(article?.firstPublishAt).toEqual(new Date("2026-01-01"));
    });

    it("preserves the legacy publication time for management operations without a prior detail read", async () => {
        article = makeBlog({ draft: false, reportCount: 2 });
        await BlogReviewModel.reset(snapshot(), 0);
        expect(article?.firstPublishAt).toEqual(new Date("2026-01-01"));
        expect(article?.reportCount).toBe(0);
    });
});

describe("independent report consistency", () => {
    it("hides only the fourth report and deduplicates a previously accepted hidden report", async () => {
        for (const uid of [3, 4, 5]) {
            expect((await BlogReviewModel.report(snapshot(), uid, 0, `report-${uid}`, after)).hidden).toBe(false);
        }
        expect(article).toMatchObject({ reportCount: 3, draft: false, reviewPending: true });
        const fourth = await BlogReviewModel.report(snapshot(), 6, 0, "fourth", after);
        expect(fourth.hidden).toBe(true);
        expect(article).toMatchObject({ reportCount: 4, draft: true, requiresReview: true });
        expect((await BlogReviewModel.report(snapshot(), 6, 0, "replacement", after)).duplicate).toBe(true);
        expect(article?.reportCount).toBe(4);
        expect(receipts.size).toBe(4);
        expect(receipts.get(BlogReviewModel.reportId(article!.docId, 0, 6))?.comments).toBe("fourth");
    });

    it("recovers a failed receipt insertion without recounting", async () => {
        reports.updateOne.mockRejectedValueOnce(new Error("store unavailable"));
        await expect(BlogReviewModel.report(snapshot(), 3, 0, "persist me", after)).rejects.toThrow(
            "store unavailable",
        );
        expect(article).toMatchObject({ reportCount: 1, pendingReportWrite: { comments: "persist me" } });
        expect(receipts.size).toBe(0);
        await BlogReviewModel.settle(snapshot());
        expect(article).toMatchObject({ reportCount: 1, writeRevision: 2 });
        expect(article).not.toHaveProperty("pendingReportWrite");
        expect(receipts.size).toBe(1);
        expect((await BlogReviewModel.report(snapshot(), 3, 0, "", after)).duplicate).toBe(true);
    });

    it("recovers failure after receipt persistence without another receipt or count", async () => {
        DocumentModel.coll.updateOne.mockRejectedValueOnce(new Error("slot cleanup failed"));
        await expect(BlogReviewModel.report(snapshot(), 3, 0, "", after)).rejects.toThrow("slot cleanup failed");
        expect(receipts.size).toBe(1);
        await Promise.all([BlogReviewModel.settle(snapshot()), BlogReviewModel.settle(snapshot())]);
        expect(article).toMatchObject({ reportCount: 1, writeRevision: 2 });
        expect(receipts.size).toBe(1);
    });

    it("does not adopt a newer mutation after a helper clears the pending slot", async () => {
        reports.updateOne.mockRejectedValueOnce(new Error("stop"));
        await expect(BlogReviewModel.report(snapshot(), 3, 0, "", after)).rejects.toThrow();
        const pending = snapshot();
        await BlogReviewModel.settle(pending);
        await BlogReviewModel.reset(snapshot(), article!.writeRevision!);
        await expect(BlogReviewModel.settle(pending)).rejects.toBeInstanceOf(ValidationError);
        expect(article?.reportCount).toBe(0);
    });

    it("acknowledges an accepted report without overwriting a subsequent reset", async () => {
        DocumentModel.coll.updateOne.mockImplementationOnce(() => {
            delete article!.pendingReportWrite;
            article!.writeRevision = 3;
            article!.reportCount = 0;
            article!.counterEpoch = 1;
            return Promise.resolve({ matchedCount: 1 });
        });
        const accepted = await BlogReviewModel.report(snapshot(), 3, 0, "accepted before reset", after);
        expect(accepted.duplicate).toBe(false);
        expect(receipts.size).toBe(1);
        expect(article).toMatchObject({ reportCount: 0, counterEpoch: 1, writeRevision: 3 });
    });

    it("allows only one accepted report when identical requests race", async () => {
        const doc = snapshot();
        const results = await Promise.allSettled([
            BlogReviewModel.report(doc, 3, 0, "A", after),
            BlogReviewModel.report(doc, 3, 0, "B", after),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(article?.reportCount).toBe(1);
        expect(receipts.size).toBe(1);
    });

    it("accumulates across content edits, then preserves deduplication after reset", async () => {
        await BlogReviewModel.report(snapshot(), 3, 0, "", after);
        article = await BlogModel.edit(snapshot(), { content: "New" }, true, after);
        expect(article.reviewPending).toBe(true);
        await BlogReviewModel.report(snapshot(), 3, 1, "", after);
        expect(article?.reportCount).toBe(2);
        await BlogReviewModel.reset(snapshot(), article.writeRevision!);
        expect(article).toMatchObject({ reportCount: 0, rejectionCount: 0, requiresReview: true, reviewPending: true });
        expect((await BlogReviewModel.report(snapshot(), 3, 1, "", after)).duplicate).toBe(true);
        expect(receipts.size).toBe(2);
    });

    it("compensates a late materializer after parent deletion", async () => {
        reports.updateOne.mockRejectedValueOnce(new Error("stop"));
        await expect(BlogReviewModel.report(snapshot(), 3, 0, "", after)).rejects.toThrow();
        const pending = snapshot();
        article = null;
        await expect(BlogReviewModel.settle(pending)).rejects.toThrow();
        expect(receipts.size).toBe(0);
    });

    it.each([{ owner: 3 }, { draft: true }, { reportApprovedVersion: 0 }])(
        "rejects ineligible reports before mutation: %j",
        async (changes) => {
            article = { ...article!, ...changes };
            await expect(BlogReviewModel.report(snapshot(), 3, 0, "", after)).rejects.toThrow();
            expect(DocumentModel.coll.findOneAndUpdate).not.toHaveBeenCalled();
        },
    );

    it("rejects disabled reporting and obsolete content versions", async () => {
        await expect(BlogReviewModel.report(snapshot(), 3, 0, "", DEFAULT_REVIEW_SETTINGS)).rejects.toThrow();
        await expect(BlogReviewModel.report(snapshot(), 3, 1, "", after)).rejects.toThrow();
        expect(receipts.size).toBe(0);
    });
});

describe("review decisions and visibility", () => {
    it("restores report-hidden content, clears counts and exempts only that content version", async () => {
        await BlogReviewModel.report(snapshot(), 3, 0, "", { ...after, reportLimit: 0 });
        await BlogReviewModel.decide(snapshot(), article!.reviewGeneration!, 0, ReviewDecisions.Approve, 9, "");
        expect(article).toMatchObject({
            draft: false,
            reportCount: 0,
            rejectionCount: 0,
            requiresReview: false,
            reportApprovedVersion: 0,
        });
        await expect(BlogReviewModel.report(snapshot(), 4, 0, "", after)).rejects.toThrow();
        article = await BlogModel.edit(snapshot(), { content: "Edited", draft: false }, true, after);
        await BlogReviewModel.report(snapshot(), 3, 1, "", after);
        expect(article?.reportCount).toBe(1);
    });

    it("does not grant reporting immunity from a publication approval", async () => {
        article = makeBlog({ reviewPending: true, reviewReason: ReviewReasons.Publication, requiresReview: true });
        await BlogReviewModel.decide(snapshot(), 0, 0, ReviewDecisions.Approve, 9, "");
        expect(article?.firstPublishAt).toBeInstanceOf(Date);
        await BlogReviewModel.report(snapshot(), 3, 0, "", after);
        expect(article?.reportCount).toBe(1);
    });

    it("takes the first conditional decision and prevents stale decisions after editing", async () => {
        article = makeBlog({ reviewPending: true, requiresReview: true });
        const doc = snapshot();
        const results = await Promise.allSettled([
            BlogReviewModel.decide(doc, 0, 0, ReviewDecisions.Reject, 8, "reason"),
            BlogReviewModel.decide(doc, 0, 0, ReviewDecisions.Approve, 9, ""),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(article).toMatchObject({ draft: true, rejectionCount: 1, lastReview: { comments: "reason" } });
        article = await BlogModel.edit(snapshot(), { draft: false, content: "new text" }, true, before);
        await expect(BlogReviewModel.decide(snapshot(), 0, 0, ReviewDecisions.Approve, 9, "")).rejects.toThrow();
    });

    it("blocks after three rejections, and reset still cannot bypass review in disabled mode", async () => {
        article = makeBlog();
        for (let count = 1; count <= 3; count++) {
            article = await BlogModel.edit(snapshot(), { draft: false }, true, before);
            await BlogReviewModel.decide(snapshot(), article.reviewGeneration!, 0, ReviewDecisions.Reject, 9, "");
            expect(article.rejectionCount).toBe(count);
        }
        await expect(BlogModel.edit(snapshot(), { draft: false }, true, after)).rejects.toThrow();
        await BlogReviewModel.reset(snapshot(), article.writeRevision!);
        article = await BlogModel.edit(snapshot(), { draft: false }, true, DEFAULT_REVIEW_SETTINGS);
        expect(article).toMatchObject({ draft: true, reviewPending: true, requiresReview: true });
    });

    it("removes private review data from ordinary responses and always removes the pending payload", async () => {
        reports.updateOne.mockRejectedValueOnce(new Error("stop"));
        await expect(BlogReviewModel.report(snapshot(), 3, 0, "private report", after)).rejects.toThrow();
        article!.lastReview = {
            reviewer: 9,
            comments: "private rejection",
            decision: ReviewDecisions.Reject,
            at: new Date(),
            version: 0,
        };
        expect(JSON.stringify(articleForReader(snapshot(), 5))).not.toMatch(
            /private report|private rejection|operationId|reportCount/,
        );
        expect(articleForReader(snapshot(), 1)).toHaveProperty("lastReview.comments", "private rejection");
        expect(articleForReader(snapshot(), 1)).not.toHaveProperty("pendingReportWrite");
    });

    it("validates optional comments without interpreting structured input", () => {
        expect(reviewComment(undefined)).toBe("");
        expect(reviewComment("  text  ")).toBe("text");
        for (const value of [{ $set: {} }, [], "x".repeat(65536)]) expect(() => reviewComment(value)).toThrow();
    });

    it.each([
        [1, false],
        [1, true],
        [5, false],
        [5, true],
    ] as const)("exposes report counts to uid=%s only with reviewer access=%s", (uid, canReview) => {
        const doc = makeBlog({ reportCount: 5, rejectionCount: 2 });
        const visible = articleForReader(doc, uid, canReview);
        if (canReview) expect(visible.reportCount).toBe(5);
        else expect(visible).not.toHaveProperty("reportCount");
        if (uid === doc.owner) expect(visible.rejectionCount).toBe(2);
        expect(doc.reportCount).toBe(5);
    });
});

describe("native review handler boundaries", () => {
    interface ReviewHandler extends Handler {
        blog: BlogPolicy;
        prepare: () => void;
        post: () => void;
        get: () => void;
        postDecide: (args: Record<string, unknown>) => Promise<void>;
        postResetReview: (args: Record<string, unknown>) => Promise<void>;
    }
    const register = vi.fn<(name: string, path: string, Class: new () => ReviewHandler) => void>();
    applyReviewHandler({ Route: register } as unknown as Context);
    const routes = new Map(register.mock.calls.map(([, path, Class]) => [path, Class]));

    function reviewer(path = "/blog/review/:did", mask = BLOG_PERM.REVIEW) {
        const handler = new (routes.get(path)!)();
        handler.user = makeUser(9);
        handler.blog = new BlogPolicy(handler.user, "reviewer", BLOG_PERM.ACCESS | mask);
        handler.ddoc = snapshot();
        return handler;
    }

    it("authorizes approval solely through review and emits one native message/audit", async () => {
        article = makeBlog({ reviewPending: true, requiresReview: true });
        const handler = reviewer();
        const prepare = vi.spyOn(handler, "prepare");
        const post = vi.spyOn(handler, "post");
        await dispatchHandler(handler, "post", () =>
            handler.postDecide({ domainId: "restricted", generation: "0", version: "0", decision: "approve" }),
        );
        expect(prepare).toHaveBeenCalledOnce();
        expect(post).toHaveBeenCalledOnce();
        expect(article?.draft).toBe(false);
        expect(OplogModel.log).toHaveBeenCalledWith(
            handler,
            "blog.review",
            expect.objectContaining({ articleDomainId: "system", decision: "approve" }),
        );
        expect(MessageModel.send).toHaveBeenCalledOnce();
        await expect(
            dispatchHandler(handler, "post", () =>
                handler.postDecide({ domainId: "restricted", generation: "0", version: "0", decision: "reject" }),
            ),
        ).rejects.toThrow();
        expect(MessageModel.send).toHaveBeenCalledOnce();
    });

    it("keeps reset permission independent and does not publish", async () => {
        article = makeBlog({ rejectionCount: 3, reportCount: 5, requiresReview: true });
        const denied = reviewer("/blog/review/:did/reset");
        await expect(
            dispatchHandler(denied, "post", () => denied.postResetReview({ domainId: "system", revision: "0" })),
        ).rejects.toThrow();
        const handler = reviewer("/blog/review/:did/reset", BLOG_PERM.RESET_REVIEW_COUNTERS);
        const prepare = vi.spyOn(handler, "prepare");
        await dispatchHandler(handler, "post", () => handler.postResetReview({ domainId: "system", revision: "0" }));
        expect(prepare).toHaveBeenCalledOnce();
        expect(article).toMatchObject({ draft: true, requiresReview: true, rejectionCount: 0, reportCount: 0 });
    });

    it("hides report counts from reset-only users without denying their reset operation", async () => {
        article = makeBlog({ reportCount: 5, rejectionCount: 3 });
        const resetOnly = reviewer("/blog/review/:did/reset", BLOG_PERM.RESET_REVIEW_COUNTERS);
        const prepare = vi.spyOn(resetOnly, "prepare");
        await dispatchHandler(resetOnly, "get", () => resetOnly.get());
        expect(prepare).toHaveBeenCalledOnce();
        expect(resetOnly.response.body).not.toHaveProperty("reportCount");
        expect(resetOnly.response.body).toMatchObject({ canViewReportCount: false, rejectionCount: 3 });
        const both = reviewer("/blog/review/:did/reset", BLOG_PERM.RESET_REVIEW_COUNTERS | BLOG_PERM.REVIEW);
        await dispatchHandler(both, "get", () => both.get());
        expect(both.response.body).toMatchObject({ canViewReportCount: true, reportCount: 5 });
    });

    it("propagates native audit failure after commit without notifying or reapplying a decision", async () => {
        article = makeBlog({ reviewPending: true, requiresReview: true });
        OplogModel.log.mockRejectedValueOnce(new Error("audit down"));
        const handler = reviewer();
        await expect(
            dispatchHandler(handler, "post", () =>
                handler.postDecide({ domainId: "system", generation: "0", version: "0", decision: "reject" }),
            ),
        ).rejects.toThrow("audit down");
        expect(article?.rejectionCount).toBe(1);
        expect(MessageModel.send).not.toHaveBeenCalled();
        await expect(
            dispatchHandler(handler, "post", () =>
                handler.postDecide({ domainId: "system", generation: "0", version: "0", decision: "reject" }),
            ),
        ).rejects.toThrow();
        expect(article?.rejectionCount).toBe(1);
    });

    it("does not admit management-only or guest identities to decisions", async () => {
        article = makeBlog({ reviewPending: true });
        const handler = reviewer("/blog/review/:did", BLOG_PERM.MANAGE_SETTINGS);
        await expect(
            dispatchHandler(handler, "post", () =>
                handler.postDecide({ domainId: "system", generation: "0", version: "0", decision: "approve" }),
            ),
        ).rejects.toThrow();
        handler.user = makeUser(0, 0);
        handler.blog = new BlogPolicy(handler.user, "guest", -1n);
        await expect(
            dispatchHandler(handler, "post", () =>
                handler.postDecide({ domainId: "system", generation: "0", version: "0", decision: "approve" }),
            ),
        ).rejects.toThrow();
        expect(DocumentModel.coll.findOneAndUpdate).not.toHaveBeenCalled();
    });
});
