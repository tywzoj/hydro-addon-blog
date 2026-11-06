import type { Context } from "hydrooj";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BlogModel, ensureIndexes } from "../../features/model";
import { makeBlog } from "../helpers/fixtures";
import { DocumentModel } from "../helpers/hydro";

beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
});

describe("publication state", () => {
    it.each([true, false])("creates a post with draft=%s and the correct publication time", async (draft) => {
        const id = makeBlog().docId;
        DocumentModel.add.mockResolvedValue(id);

        await expect(BlogModel.add(7, "Title", "Content", draft, true, "192.0.2.1")).resolves.toEqual(id);

        expect(DocumentModel.add).toHaveBeenCalledWith(
            "system",
            "Content",
            7,
            70,
            null,
            null,
            null,
            expect.objectContaining({ title: "Title", draft, pin: true, ip: "192.0.2.1", nReply: 0, views: 0 }),
        );
        const fields = DocumentModel.add.mock.calls[0][7];
        expect(fields).toEqual({
            title: "Title",
            draft,
            pin: true,
            ip: "192.0.2.1",
            nReply: 0,
            updateAt: new Date(),
            views: 0,
            ...(draft ? {} : { firstPublishAt: new Date() }),
        });
    });

    it("assigns the first publication time when a draft is first published", async () => {
        const draft = makeBlog();
        const updated = makeBlog({ draft: false, firstPublishAt: new Date() });
        DocumentModel.set.mockResolvedValue(updated);

        await expect(BlogModel.edit(draft, { draft: false })).resolves.toEqual(updated);
        expect(DocumentModel.set).toHaveBeenCalledWith("system", 70, draft.docId, {
            draft: false,
            updateAt: new Date(),
            firstPublishAt: new Date(),
        });
        expect(draft.firstPublishAt).toBeUndefined();
    });

    it.each([{ title: "Edited" }, { draft: true }, { draft: false }])(
        "preserves an existing publication time during %j",
        async (update) => {
            const doc = makeBlog({ firstPublishAt: new Date("2026-01-02T00:00:00Z") });
            DocumentModel.set.mockResolvedValue(doc);

            await BlogModel.edit(doc, update);

            expect(DocumentModel.set).toHaveBeenCalledWith("system", 70, doc.docId, {
                ...update,
                updateAt: new Date(),
            });
        },
    );

    it.each([{ title: "Draft edit" }, { draft: true }])(
        "does not publish an unpublished draft during %j",
        async (update) => {
            const doc = makeBlog();
            DocumentModel.set.mockResolvedValue(doc);
            await BlogModel.edit(doc, update);
            expect(DocumentModel.set).toHaveBeenCalledWith("system", 70, doc.docId, {
                ...update,
                updateAt: new Date(),
            });
        },
    );

    it("falls back to updateAt on a legacy published read without writing a backfill", async () => {
        const stored = makeBlog({ draft: false });
        DocumentModel.get.mockResolvedValue(structuredClone(stored));

        const result = await BlogModel.get(stored.docId);

        expect(result?.firstPublishAt).toEqual(stored.updateAt);
        expect(stored.firstPublishAt).toBeUndefined();
        expect(DocumentModel.get).toHaveBeenCalledWith("system", 70, stored.docId);
        expect(DocumentModel.set).not.toHaveBeenCalled();
    });

    it.each([null, makeBlog(), makeBlog({ draft: false, firstPublishAt: new Date(1234) })])(
        "preserves missing, draft, or already timestamped reads",
        async (doc) => {
            const expected = doc ? { ...doc } : null;
            DocumentModel.get.mockResolvedValue(doc);
            expect(await BlogModel.get(makeBlog().docId)).toEqual(expected);
            expect(DocumentModel.set).not.toHaveBeenCalled();
        },
    );
});

describe("persistence mutations", () => {
    it("deletes both the post and all user statuses", async () => {
        const { docId } = makeBlog();
        DocumentModel.deleteOne.mockResolvedValue({});
        DocumentModel.deleteMultiStatus.mockResolvedValue({});

        await BlogModel.del(docId);

        expect(DocumentModel.deleteOne).toHaveBeenCalledWith("system", 70, docId);
        expect(DocumentModel.deleteMultiStatus).toHaveBeenCalledWith("system", 70, { docId });
    });

    it("propagates a status deletion failure without claiming successful deletion", async () => {
        const failure = new Error("Status store unavailable");
        DocumentModel.deleteOne.mockResolvedValue({});
        DocumentModel.deleteMultiStatus.mockRejectedValue(failure);
        await expect(BlogModel.del(makeBlog().docId)).rejects.toBe(failure);
    });

    it("adds a reply and updates its counter and update time", async () => {
        const { docId } = makeBlog();
        const replyId = new ObjectId("000000000000000000000003");
        DocumentModel.push.mockResolvedValue([1, replyId]);
        DocumentModel.incAndSet.mockResolvedValue(makeBlog());

        await expect(BlogModel.addReply(docId, 7, "Reply", "192.0.2.1")).resolves.toEqual(replyId);

        expect(DocumentModel.push).toHaveBeenCalledWith("system", 70, docId, "reply", "Reply", 7, { ip: "192.0.2.1" });
        expect(DocumentModel.incAndSet).toHaveBeenCalledWith("system", 70, docId, "nReply", 1, {
            updateAt: new Date(),
        });
    });

    it.each([true, false])("writes a per-user star-only update with star=%s", async (star) => {
        const { docId } = makeBlog();
        await BlogModel.setStar(docId, 7, star);
        expect(DocumentModel.setStatus).toHaveBeenCalledWith("system", 70, docId, 7, { star });
    });

    it("propagates a failed edit", async () => {
        const failure = new Error("Write failed");
        DocumentModel.set.mockRejectedValue(failure);
        await expect(BlogModel.edit(makeBlog(), { title: "Edited" })).rejects.toBe(failure);
    });
});

describe("blog indexes", () => {
    it("scopes every list index to system blog documents in the shared collection", async () => {
        const ensure = vi.fn<(...args: unknown[]) => Promise<void>>();
        await ensureIndexes({ db: { ensureIndexes: ensure } } as unknown as Context);

        const [collection, ...indexes] = ensure.mock.calls[0];
        expect(collection).toBe(DocumentModel.coll);
        expect(indexes).toHaveLength(6);
        for (const index of indexes) {
            expect(index).toEqual(
                expect.objectContaining({ partialFilterExpression: { domainId: "system", docType: 70 } }),
            );
        }
        expect(indexes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ key: { firstPublishAt: -1, draft: 1 } }),
                expect.objectContaining({ key: { owner: 1, pin: -1, firstPublishAt: -1, draft: 1 } }),
            ]),
        );
    });
});
