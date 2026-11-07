import type { Context } from "hydrooj";
import { ObjectId } from "hydrooj";
import type { Collection } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    BLOG_PERM,
    DEFAULT_REVIEW_SETTINGS,
    ReviewDecisions,
    ReviewMessages,
    ReviewModes,
    ReviewReasons,
} from "../../features/constants";
import { BlogModel } from "../../features/model";
import { BlogPolicy } from "../../features/permission";
import { applyReviewHandler } from "../../features/review.handler";
import { articleForReader, BlogReviewModel, publicationUpdate, reviewComment } from "../../features/review.model";
import { BlogSettingsModel } from "../../features/settings.model";
import type { BlogDoc, BlogReport } from "../../features/types";
import { makeBlog } from "../helpers/fixtures";
import type { Handler } from "../helpers/hydro";
import {
    dispatchHandler,
    DocumentModel,
    DocumentNotFoundError,
    makeUser,
    MessageModel,
    OplogModel,
    UserModel,
    ValidationError,
} from "../helpers/hydro";

let article: BlogDoc | null;
const receipts = new Map<string, BlogReport>();
const reports = {
    find: vi.fn(),
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

    it("finishes an empty queue without decisions or notifications", async () => {
        const cursor = queueOnce();
        cursor.toArray.mockReset().mockResolvedValue([]);
        const notify = vi.fn();
        expect(await BlogReviewModel.approvePending(9, new Date(), notify)).toBe(0);
        expect(DocumentModel.get).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });

    it("skips an article deleted during a decision and continues the sweep", async () => {
        article = makeBlog({ reviewPending: true });
        queueOnce();
        vi.spyOn(BlogReviewModel, "decide").mockRejectedValue(new DocumentNotFoundError());
        const notify = vi.fn();
        expect(await BlogReviewModel.approvePending(9, new Date(), notify)).toBe(0);
        expect(notify).not.toHaveBeenCalled();
    });

    it("retries review conflicts but propagates integrity and storage failures", async () => {
        article = makeBlog({ reviewPending: true });
        queueOnce();
        const decide = vi
            .spyOn(BlogReviewModel, "decide")
            .mockRejectedValueOnce(new ValidationError("review", null, ReviewMessages.Changed))
            .mockResolvedValue({ ...snapshot(), reviewPending: false });
        const notify = vi.fn();
        expect(await BlogReviewModel.approvePending(9, new Date(), notify)).toBe(1);
        expect(decide).toHaveBeenCalledTimes(2);
        for (const failure of [new ValidationError("report", null, ReviewMessages.Integrity), new Error("offline")]) {
            queueOnce();
            decide.mockClear().mockRejectedValue(failure);
            await expect(BlogReviewModel.approvePending(9, new Date(), notify)).rejects.toBe(failure);
            expect(decide).toHaveBeenCalledOnce();
        }
    });

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
        expect(await BlogReviewModel.approvePending(9, new Date(), notify)).toBe(101);
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
        expect(await BlogReviewModel.approvePending(9, new Date(), notify)).toBe(1);
        expect(notify).toHaveBeenCalledOnce();
        expect(receipts.size).toBe(1);
        expect(article?.lastReview?.reviewer).toBe(9);
    });

    it("does not override a manual rejection that wins the conditional write", async () => {
        article = makeBlog({ reviewPending: true, requiresReview: true, reviewReason: ReviewReasons.Publication });
        queueOnce();
        const notify = vi.fn();
        await Promise.all([
            BlogReviewModel.approvePending(9, new Date(), notify),
            BlogReviewModel.decide(snapshot(), 0, 0, ReviewDecisions.Reject, 8, "Rejected first"),
        ]);
        expect(article).toMatchObject({ draft: true, reviewPending: false, rejectionCount: 1 });
        expect(notify).not.toHaveBeenCalled();
    });

    it("excludes later submissions even when the sweep starts after them", async () => {
        const cutoff = new Date(Date.now() - 60_000);
        article = makeBlog({ reviewPending: true, requiresReview: true });
        queueOnce();
        article.reviewQueuedAt = new Date();
        const notify = vi.fn();
        expect(await BlogReviewModel.approvePending(9, cutoff, notify)).toBe(0);
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
        expect(await BlogReviewModel.approvePending(9, new Date(), notify)).toBe(1);
        expect(article?.lastReview?.version).toBe(1);
        expect(notify).toHaveBeenCalledOnce();

        article = makeBlog({ reviewPending: true, requiresReview: true });
        queueOnce();
        DocumentModel.coll.findOneAndUpdate.mockClear().mockResolvedValue(null);
        await expect(BlogReviewModel.approvePending(9, new Date(), notify)).rejects.toBeInstanceOf(ValidationError);
        expect(DocumentModel.coll.findOneAndUpdate).toHaveBeenCalledTimes(3);
    });

    it("propagates delivery failure without applying the same approval again on retry", async () => {
        article = makeBlog({ reviewPending: true, requiresReview: true });
        queueOnce();
        const notify = vi.fn().mockRejectedValue(new Error("notice failed"));
        await expect(BlogReviewModel.approvePending(9, new Date(), notify)).rejects.toThrow("notice failed");
        expect(article?.reviewPending).toBe(false);
        queueOnce();
        expect(await BlogReviewModel.approvePending(9, new Date(), notify)).toBe(0);
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
    it("leaves an article without a pending receipt untouched during recovery", async () => {
        await BlogReviewModel.materialize(snapshot());
        expect(reports.updateOne).not.toHaveBeenCalled();
        expect(DocumentModel.coll.updateOne).not.toHaveBeenCalled();
    });

    it.each(["missing", "operationId", "comments", "revision"])(
        "preserves the pending slot when the stored receipt has a conflicting %s",
        async (field) => {
            reports.updateOne.mockRejectedValueOnce(new Error("pause receipt"));
            await expect(BlogReviewModel.report(snapshot(), 3, 0, "original", after)).rejects.toThrow("pause receipt");
            const pending = snapshot();
            const stored = { ...pending.pendingReportWrite! };
            const mismatch = field === "missing" ? null : { ...stored, [field]: field === "revision" ? 99 : "other" };
            reports.findOne.mockResolvedValueOnce(mismatch);
            await expect(BlogReviewModel.materialize(pending)).rejects.toBeInstanceOf(ValidationError);
            expect(DocumentModel.coll.updateOne).not.toHaveBeenCalled();
            expect(article?.pendingReportWrite).toEqual(pending.pendingReportWrite);
        },
    );

    it("rejects a report counter overflow without accepting a receipt", async () => {
        article!.reportCount = Number.MAX_SAFE_INTEGER;
        await expect(BlogReviewModel.report(snapshot(), 3, 0, "", after)).rejects.toBeInstanceOf(ValidationError);
        expect(DocumentModel.coll.findOneAndUpdate).not.toHaveBeenCalled();
        expect(receipts.size).toBe(0);
    });

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
    it("rejects an overflowing rejection count and a stale reset without mutation", async () => {
        article = makeBlog({ reviewPending: true, rejectionCount: Number.MAX_SAFE_INTEGER, writeRevision: 4 });
        await expect(BlogReviewModel.decide(snapshot(), 0, 0, ReviewDecisions.Reject, 9, "")).rejects.toBeInstanceOf(
            ValidationError,
        );
        await expect(BlogReviewModel.reset(snapshot(), 3)).rejects.toBeInstanceOf(ValidationError);
        expect(DocumentModel.coll.findOneAndUpdate).not.toHaveBeenCalled();
    });

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
        expect(visible).not.toHaveProperty("rejectionCount");
        expect(doc.rejectionCount).toBe(2);
        expect(doc.reportCount).toBe(5);
    });
});

describe("native review handler boundaries", () => {
    interface ReviewHandler extends Handler {
        blog: BlogPolicy;
        prepare: () => void;
        post: () => void;
        get: (args?: Record<string, unknown>) => unknown;
        _prepare: (args: Record<string, unknown>) => Promise<void>;
        postDecide: (args: Record<string, unknown>) => Promise<void>;
        postResetReview: (args: Record<string, unknown>) => Promise<void>;
        postReport: (args: Record<string, unknown>) => Promise<void>;
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

    it.each(["/blog/review", "/blog/review/:did"])(
        "omits article IPs at %s without hiding review tokens",
        async (path) => {
            article = makeBlog({
                ip: "192.0.2.20",
                reviewPending: true,
                contentVersion: 2,
                reviewGeneration: 3,
                reportCount: 4,
                reply: [{ _id: new ObjectId(), owner: 3, content: "Legacy reply", ip: "192.0.2.21" }],
            });
            const handler = reviewer(path);
            const cursor = { project: vi.fn(), sort: vi.fn() };
            cursor.project.mockReturnValue(cursor);
            cursor.sort.mockReturnValue(cursor);
            DocumentModel.getMulti.mockReturnValue(cursor);
            reports.find.mockReturnValue(cursor);
            const list = path === "/blog/review";
            handler.ctx.db.paginate.mockResolvedValue([list ? [snapshot()] : [], 1, 1]);
            UserModel.getList.mockResolvedValue({});
            DocumentModel.count.mockResolvedValue(1);
            await dispatchHandler(handler, "get", () => handler.get({ domainId: "system" }));
            const body = handler.response.body as { ddoc?: BlogDoc; ddocs?: BlogDoc[] };
            const exposed = list ? body.ddocs![0] : body.ddoc!;
            expect(exposed).not.toHaveProperty("ip");
            expect(exposed.reply[0]).not.toHaveProperty("ip");
            expect(exposed).toMatchObject({ contentVersion: 2, reviewGeneration: 3, reportCount: 4 });
            expect(article.ip).toBe("192.0.2.20");
            expect(article.reply[0].ip).toBe("192.0.2.21");
        },
    );

    it("loads review targets by converted ID and rejects missing targets", async () => {
        const handler = reviewer();
        await handler._prepare({ domainId: "restricted", did: article!.docId.toHexString() });
        expect(DocumentModel.get).toHaveBeenCalledWith("system", 70, article!.docId);
        expect(handler.ddoc).toEqual(article);
        article = null;
        await expect(
            handler._prepare({ domainId: "restricted", did: handler.ddoc.docId.toHexString() }),
        ).rejects.toBeInstanceOf(DocumentNotFoundError);
    });

    it("lists the private pending queue with stable sorting, pagination and author hydration", async () => {
        const handler = reviewer("/blog/review");
        const cursor = { project: vi.fn(), sort: vi.fn() };
        cursor.project.mockReturnValue(cursor);
        cursor.sort.mockReturnValue(cursor);
        DocumentModel.getMulti.mockReturnValue(cursor);
        article!.reviewPending = true;
        handler.ctx.db.paginate.mockResolvedValue([[snapshot()], 2, 21]);
        DocumentModel.count.mockResolvedValue(21);
        const users = { 1: makeUser(1) };
        UserModel.getList.mockResolvedValue(users);
        await dispatchHandler(handler, "get", () => handler.get({ domainId: "system" }));
        expect(DocumentModel.getMulti).toHaveBeenCalledWith("system", 70, { reviewPending: true });
        expect(cursor.project).toHaveBeenCalledWith({ pendingReportWrite: 0, lastReview: 0 });
        expect(cursor.sort).toHaveBeenCalledWith({ reviewQueuedAt: 1, docId: 1 });
        expect(handler.ctx.db.paginate).toHaveBeenCalledWith(cursor, 1, 20);
        expect(UserModel.getList).toHaveBeenCalledWith("system", [1]);
        expect(handler.response).toEqual({
            template: "blog_review.html",
            body: { ddocs: [snapshot()], dpcount: 2, page: 1, udict: users, pendingCount: 21 },
        });
    });

    it("loads reports only for the pending article and hydrates their reporters", async () => {
        article!.reviewPending = true;
        const handler = reviewer();
        const cursor = { sort: vi.fn() };
        cursor.sort.mockReturnValue(cursor);
        reports.find.mockReturnValue(cursor);
        const report = { reporter: 3, comments: "Private report" };
        const paginate = vi.fn().mockResolvedValue([[report], 1, 1]);
        Object.assign(handler.ctx.db, { paginate });
        const users = { 1: makeUser(1), 3: makeUser(3) };
        UserModel.getList.mockResolvedValue(users);
        await dispatchHandler(handler, "get", () => handler.get({ domainId: "system" }));
        expect(reports.find).toHaveBeenCalledWith({ articleId: article!.docId });
        expect(cursor.sort).toHaveBeenCalledWith({ acceptedAt: -1, _id: 1 });
        expect(paginate).toHaveBeenCalledWith(cursor, 1, 20);
        expect(UserModel.getList).toHaveBeenCalledWith("system", [1, 3]);
        expect(handler.response).toEqual({
            template: "blog_review_detail.html",
            body: { ddoc: snapshot(), reports: [report], page: 1, dpcount: 1, udict: users, canReset: false },
        });
    });

    it("does not display reports for an article no longer awaiting review", async () => {
        const handler = reviewer();
        await expect(dispatchHandler(handler, "get", () => handler.get())).rejects.toBeInstanceOf(ValidationError);
        expect(reports.find).not.toHaveBeenCalled();
        expect(handler.response.body).toBeUndefined();
    });

    it.each(["/blog/review", "/blog/review/:did"])("denies unauthorized queue reads at %s", async (path) => {
        const handler = reviewer(path, BLOG_PERM.MANAGE_SETTINGS);
        await expect(dispatchHandler(handler, "get", () => handler.get())).rejects.toThrow();
        expect(DocumentModel.getMulti).not.toHaveBeenCalled();
        expect(reports.find).not.toHaveBeenCalled();
    });

    it("sends a rejection notice with the validated comment and original version", async () => {
        article = makeBlog({ reviewPending: true, contentVersion: 4, reviewGeneration: 2 });
        const handler = reviewer();
        await dispatchHandler(handler, "post", () =>
            handler.postDecide({
                domainId: "restricted",
                generation: "2",
                version: "4",
                decision: "reject",
                comments: "  Revise this  ",
            }),
        );
        expect(article?.lastReview).toMatchObject({ version: 4, comments: "Revise this", decision: "reject" });
        expect(JSON.parse(MessageModel.send.mock.calls[0][2] as string)).toMatchObject({
            params: ["Test post", 4, "Revise this", "/blog_post_detail"],
        });
        expect(handler.response).toMatchObject({ body: { decision: "reject" }, redirect: "/blog_review" });
    });

    it("renders zero counters for legacy reset targets", async () => {
        const handler = reviewer("/blog/review/:did/reset", BLOG_PERM.REVIEW | BLOG_PERM.RESET_REVIEW_COUNTERS);
        await dispatchHandler(handler, "get", () => handler.get());
        expect(handler.response.body).toEqual({
            did: article!.docId,
            revision: 0,
            reportCount: 0,
            rejectionCount: 0,
            canViewReportCount: true,
        });
    });

    it.each([0, 3])("accepts a report and sends an author notice only above limit %s", async (reportLimit) => {
        vi.spyOn(BlogSettingsModel, "review").mockResolvedValue({ ...after, reportLimit });
        const handler = reviewer("/blog/:uid/:did/report", BLOG_PERM.VIEW_PUBLISHED);
        await dispatchHandler(handler, "post", () =>
            handler.postReport({
                domainId: "restricted",
                version: "0",
                comments: "  Please review  ",
                reporter: 3,
                uid: 3,
                owner: 9,
                reportCount: 999,
            }),
        );
        expect(handler.limitRate).toHaveBeenCalledWith("report_blog", 3600, 60);
        expect(receipts.size).toBe(1);
        expect(article).toMatchObject({ owner: 1, reportCount: 1, draft: reportLimit === 0 });
        expect([...receipts.values()]).toEqual([
            expect.objectContaining({ reporter: 9, version: 0, comments: "Please review" }),
        ]);
        expect(OplogModel.log).toHaveBeenCalledWith(
            handler,
            "blog.report",
            expect.objectContaining({
                comments: "Please review",
                hidden: reportLimit === 0,
                previous: expect.objectContaining({ reportCount: 0 }) as unknown,
            }),
        );
        expect(MessageModel.send).toHaveBeenCalledTimes(reportLimit === 0 ? 1 : 0);
        expect(handler.response).toEqual({
            body: { reported: true, duplicate: false },
            redirect: "/blog_list_home",
        });
    });

    it.each(["receipt", "pending"])(
        "acknowledges the reporter's hidden %s without duplicate side effects",
        async (state) => {
            vi.spyOn(BlogSettingsModel, "review").mockResolvedValue(after);
            if (state === "pending") {
                reports.updateOne.mockRejectedValueOnce(new Error("pause"));
                await expect(
                    BlogReviewModel.report(snapshot(), 9, 0, "Original", { ...after, reportLimit: 0 }),
                ).rejects.toThrow("pause");
            } else {
                await BlogReviewModel.report(snapshot(), 9, 0, "Original", { ...after, reportLimit: 0 });
            }
            const handler = reviewer("/blog/:uid/:did/report", BLOG_PERM.VIEW_PUBLISHED);
            await dispatchHandler(handler, "post", () => handler.postReport({ domainId: "system", version: "0" }));
            expect(handler.response.body).toEqual({ reported: true, duplicate: true });
            expect(article?.reportCount).toBe(1);
            expect(receipts.size).toBe(1);
            expect(OplogModel.log).not.toHaveBeenCalled();
            expect(MessageModel.send).not.toHaveBeenCalled();
        },
    );

    it("denies a hidden article to another reporter before rate limiting", async () => {
        await BlogReviewModel.report(snapshot(), 3, 0, "", { ...after, reportLimit: 0 });
        const handler = reviewer("/blog/:uid/:did/report", BLOG_PERM.VIEW_PUBLISHED);
        await expect(
            dispatchHandler(handler, "post", () => handler.postReport({ domainId: "system", version: "0" })),
        ).rejects.toThrow();
        expect(handler.limitRate).not.toHaveBeenCalled();
        expect(article?.reportCount).toBe(1);
    });

    it("does not accept a report after rate limiting fails", async () => {
        const handler = reviewer("/blog/:uid/:did/report", BLOG_PERM.VIEW_PUBLISHED);
        handler.limitRate.mockRejectedValue(new Error("rate limited"));
        await expect(
            dispatchHandler(handler, "post", () => handler.postReport({ domainId: "system", version: "0" })),
        ).rejects.toThrow("rate limited");
        expect(DocumentModel.coll.findOneAndUpdate).not.toHaveBeenCalled();
        expect(OplogModel.log).not.toHaveBeenCalled();
        expect(handler.response.body).toBeUndefined();
    });

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
        await dispatchHandler(handler, "post", () =>
            handler.postResetReview({
                domainId: "system",
                revision: "0",
                draft: false,
                requiresReview: false,
                owner: 9,
            }),
        );
        expect(prepare).toHaveBeenCalledOnce();
        expect(article).toMatchObject({
            owner: 1,
            draft: true,
            requiresReview: true,
            rejectionCount: 0,
            reportCount: 0,
        });
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
