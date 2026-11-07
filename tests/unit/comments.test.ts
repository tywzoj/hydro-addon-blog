import type { Context } from "hydrooj";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BlogCommentHandler } from "../../features/comments.handler";
import { BlogCommentModel, ensureCommentIndexes } from "../../features/comments.model";
import { BLOG_DEFAULT, BLOG_PERM, BlogPermissions } from "../../features/constants";
import { BlogModel } from "../../features/model";
import { BlogPermissionError, BlogPolicy } from "../../features/permission";
import { initialSettings, resolveBlogPolicy } from "../../features/settings.model";
import type { BlogCommentDoc } from "../../features/types";
import { makeBlog } from "../helpers/fixtures";
import {
    dispatchHandler,
    DocumentModel,
    DocumentNotFoundError,
    makeUser,
    MessageModel,
    OplogModel,
    PRIV,
    UserModel,
    ValidationError,
} from "../helpers/hydro";

const article = makeBlog({ draft: false });
const id = new ObjectId();
const tailId = new ObjectId();
function comment(): BlogCommentDoc {
    return {
        _id: id,
        docId: id,
        domainId: "system",
        docType: 71,
        parentType: 70,
        parentId: article.docId,
        owner: 2,
        content: "Comment content",
        nLike: 0,
        reply: [{ _id: tailId, owner: 3, content: "Tail content", nLike: 0 }],
    };
}
const own = BLOG_PERM.DELETE_COMMENT_OWN;
const globalDelete = BLOG_PERM.DELETE_COMMENT;
const ownPost = BLOG_PERM.DELETE_COMMENT_IN_OWN_POST;
const base = BLOG_PERM.ACCESS | BLOG_PERM.VIEW_PUBLISHED;

function policy(uid: number, permissions: bigint) {
    return new BlogPolicy(makeUser(uid), "test", base | permissions);
}

function handler(uid = 2, mask = BLOG_DEFAULT) {
    // The test setup replaces Hydro's constructor with the zero-argument Handler fixture.
    const TestHandler = BlogCommentHandler as unknown as new () => BlogCommentHandler;
    const h = new TestHandler();
    Object.assign(h, {
        user: makeUser(uid),
        udoc: makeUser(article.owner),
        ddoc: article,
        blog: new BlogPolicy(makeUser(uid), "test", mask),
    });
    return h;
}

beforeEach(() => {
    vi.resetAllMocks();
    DocumentModel.get.mockResolvedValue(article);
    DocumentModel.coll.findOne.mockResolvedValue(comment());
    DocumentModel.coll.findOneAndUpdate.mockResolvedValue(article);
    DocumentModel.coll.updateOne.mockResolvedValue({ matchedCount: 1 });
    DocumentModel.add.mockResolvedValue(id);
});

describe("comment permissions", () => {
    it.each([
        [2, 2, false, own, true],
        [2, 2, false, globalDelete, false],
        [2, 2, true, globalDelete, true],
        [1, 2, false, ownPost, true],
        [1, 2, true, ownPost, false],
        [1, 1, false, ownPost, true],
        [1, 1, true, ownPost, false],
        [2, 3, false, own, false],
        [2, 3, true, own, false],
        [2, 3, false, globalDelete, true],
        [2, 3, true, globalDelete, true],
        [2, 2, true, own, true],
    ])("uses the native deletion branch uid=%i target=%i nested=%s mask=%s", (uid, owner, nested, mask, allowed) => {
        const p = policy(uid, mask);
        expect(p.canDeleteComment(article, owner, nested)).toBe(allowed);
        if (allowed) expect(() => p.requireDeleteComment(article, owner, nested)).not.toThrow();
        else expect(() => p.requireDeleteComment(article, owner, nested)).toThrow();
    });

    it("does not grant moderation from article ownership or settings rights", () => {
        expect(policy(1, BLOG_PERM.MANAGE_SETTINGS | BLOG_PERM.DELETE_OWN).canDeleteComment(article, 2)).toBe(false);
    });

    it("uses posting permission for likes, while reading needs no extra comment grant", () => {
        expect(policy(2, 0n).readable(article)).toBe(true);
        expect(policy(2, 0n).canComment(article)).toBe(false);
        expect(policy(2, BLOG_PERM.CREATE_COMMENT).canComment(article)).toBe(true);
        expect(policy(2, BLOG_PERM.CREATE_COMMENT).canComment({ ...article, draft: true })).toBe(false);
    });

    it("grants fresh default comment capabilities but does not augment stored role masks", () => {
        const fresh = initialSettings();
        expect(resolveBlogPolicy(makeUser(2), fresh).has(BlogPermissions.CREATE_COMMENT)).toBe(true);
        fresh.roles.find((r) => r.name === "default")!.permissions = base.toString();
        expect(resolveBlogPolicy(makeUser(2), fresh).has(BlogPermissions.CREATE_COMMENT)).toBe(false);
        expect(
            resolveBlogPolicy(makeUser(4, PRIV.PRIV_USER_PROFILE | PRIV.PRIV_EDIT_SYSTEM), fresh).has(
                BlogPermissions.DELETE_COMMENT,
            ),
        ).toBe(true);
    });

    it("forbids guest writes even with every permission bit", () => {
        const guest = new BlogPolicy(makeUser(0, 0), "guest", -1n);
        expect(guest.readable(article)).toBe(true);
        expect(guest.canComment(article)).toBe(false);
        expect(guest.canDeleteComment(article, 0)).toBe(false);
        expect(() => guest.requireComment(article)).toThrow();
    });
});

describe("comment persistence", () => {
    it("does not load likes for anonymous readers even when comments are present", async () => {
        expect(await BlogCommentModel.getLikes(article.docId, [id, tailId], 0)).toEqual({});
        expect(DocumentModel.collStatus.find).not.toHaveBeenCalled();
    });

    it("rejects a reply whose parent disappears during the append", async () => {
        DocumentModel.push.mockResolvedValue([null, tailId]);
        await expect(BlogCommentModel.addTail(article.docId, id, 3, "text", "ip")).rejects.toBeInstanceOf(
            DocumentNotFoundError,
        );
        expect(DocumentModel.deleteSub).not.toHaveBeenCalled();
        expect(DocumentModel.collStatus.deleteMany).not.toHaveBeenCalled();
    });

    it("does not compensate a no-op like when publication changes", async () => {
        DocumentModel.collStatus.findOneAndUpdate.mockResolvedValue(null);
        DocumentModel.get.mockResolvedValueOnce(article).mockResolvedValueOnce({ ...article, draft: true });
        await expect(BlogCommentModel.like(article.docId, id, undefined, 2, true)).rejects.toBeInstanceOf(
            ValidationError,
        );
        expect(DocumentModel.collStatus.updateOne).not.toHaveBeenCalled();
        expect(DocumentModel.coll.updateOne).not.toHaveBeenCalled();
    });

    it("keeps comment and like indexes scoped within the shared collections", async () => {
        const ensureIndexes = vi.fn();
        await ensureCommentIndexes({ db: { ensureIndexes } } as unknown as Context);
        expect(ensureIndexes.mock.calls).toEqual([
            [
                DocumentModel.coll,
                {
                    name: "blogCommentsByArticle",
                    key: { parentId: 1, _id: -1 },
                    partialFilterExpression: { domainId: "system", docType: 71, parentType: 70 },
                },
            ],
            [
                DocumentModel.collStatus,
                {
                    name: "blogCommentLikesByArticle",
                    key: { parentId: 1, commentId: 1 },
                    partialFilterExpression: { domainId: "system", docType: 71 },
                },
            ],
        ]);
    });

    it("scopes top-level insertion and updates only the reply count", async () => {
        await expect(BlogCommentModel.add(article.docId, 2, "text", "192.0.2.1")).resolves.toEqual(id);
        expect(DocumentModel.add).toHaveBeenCalledWith("system", "text", 2, 71, null, 70, article.docId, {
            ip: "192.0.2.1",
            nLike: 0,
            reply: [],
        });
        expect(DocumentModel.coll.findOneAndUpdate).toHaveBeenCalledWith(
            { domainId: "system", docType: 70, docId: article.docId, draft: { $ne: true } },
            { $inc: { nReply: 1 } },
            { returnDocument: "after" },
        );
        expect(DocumentModel.set).not.toHaveBeenCalled();
    });

    it("removes an insertion if the article was deleted or withdrawn before counting", async () => {
        DocumentModel.coll.findOneAndUpdate.mockResolvedValue(null);
        await expect(BlogCommentModel.add(article.docId, 2, "text", "ip")).rejects.toThrow();
        expect(DocumentModel.coll.deleteOne).toHaveBeenCalledWith(
            expect.objectContaining({ parentId: article.docId, docId: id, docType: 71 }),
        );
        expect(DocumentModel.collStatus.deleteMany).toHaveBeenCalled();
    });

    it.each([null, { ...article, draft: true }])("denies writes to unavailable articles", async (doc) => {
        DocumentModel.get.mockResolvedValue(doc);
        await expect(BlogCommentModel.add(article.docId, 2, "text", "ip")).rejects.toThrow();
        await expect(BlogCommentModel.like(article.docId, id, undefined, 2, true)).rejects.toThrow();
        expect(DocumentModel.add).not.toHaveBeenCalled();
        expect(DocumentModel.collStatus.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("validates the full parent query and nested membership", async () => {
        await BlogCommentModel.get(article.docId, id, tailId);
        expect(DocumentModel.coll.findOne).toHaveBeenCalledWith({
            domainId: "system",
            docType: 71,
            parentType: 70,
            parentId: article.docId,
            docId: id,
        });
        await expect(BlogCommentModel.get(article.docId, id, new ObjectId())).rejects.toBeInstanceOf(
            DocumentNotFoundError,
        );
        DocumentModel.coll.findOne.mockResolvedValue(null);
        await expect(BlogCommentModel.get(article.docId, id)).rejects.toBeInstanceOf(DocumentNotFoundError);
    });

    it("appends a nested reply without touching article counters or timestamps", async () => {
        DocumentModel.push.mockResolvedValue([comment(), tailId]);
        await expect(BlogCommentModel.addTail(article.docId, id, 3, "Tail content", "ip")).resolves.toEqual(tailId);
        expect(DocumentModel.push).toHaveBeenCalledWith("system", 71, id, "reply", "Tail content", 3, {
            ip: "ip",
            nLike: 0,
        });
        expect(DocumentModel.inc).not.toHaveBeenCalled();
        expect(DocumentModel.set).not.toHaveBeenCalled();
    });

    it("removes a nested reply if its article was withdrawn while it was being created", async () => {
        DocumentModel.push.mockResolvedValue([comment(), tailId]);
        DocumentModel.get.mockResolvedValueOnce(article).mockResolvedValueOnce({ ...article, draft: true });
        await expect(BlogCommentModel.addTail(article.docId, id, 3, "Tail content", "ip")).rejects.toThrow();
        expect(DocumentModel.deleteSub).toHaveBeenCalledWith("system", 71, id, "reply", tailId);
        expect(DocumentModel.collStatus.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ docId: tailId }));
    });

    it("does not report success when the top-level comment disappeared after appending a reply", async () => {
        DocumentModel.push.mockResolvedValue([comment(), tailId]);
        DocumentModel.coll.findOne.mockResolvedValueOnce(comment()).mockResolvedValueOnce(null);
        await expect(BlogCommentModel.addTail(article.docId, id, 3, "Tail content", "ip")).rejects.toBeInstanceOf(
            DocumentNotFoundError,
        );
        expect(DocumentModel.deleteSub).toHaveBeenCalled();
    });

    it("counts a repeated/concurrent top-level deletion only when removal succeeded", async () => {
        DocumentModel.coll.findOneAndDelete.mockResolvedValueOnce(comment()).mockResolvedValueOnce(null);
        await BlogCommentModel.delete(article.docId, id);
        await BlogCommentModel.delete(article.docId, id);
        expect(DocumentModel.inc).toHaveBeenCalledExactlyOnceWith("system", 70, article.docId, "nReply", -1);
        expect(DocumentModel.collStatus.deleteMany).toHaveBeenCalledWith({
            domainId: "system",
            docType: 71,
            parentId: article.docId,
            commentId: id,
        });
    });

    it("deletes only the nested target and its likes without decrementing top-level count", async () => {
        await BlogCommentModel.delete(article.docId, id, tailId);
        expect(DocumentModel.coll.updateOne).toHaveBeenCalledWith(expect.objectContaining({ "reply._id": tailId }), {
            $pull: { reply: { _id: tailId } },
        });
        expect(DocumentModel.inc).not.toHaveBeenCalled();
        expect(DocumentModel.collStatus.deleteMany).toHaveBeenCalledWith(
            expect.objectContaining({ commentId: id, docId: tailId }),
        );
    });

    it("cleans all comment documents and like statuses through both article delete paths", async () => {
        DocumentModel.coll.deleteOne.mockResolvedValue({ deletedCount: 1 });
        await BlogModel.del(article.docId);
        await BlogModel.deleteChecked(article);
        expect(DocumentModel.coll.deleteMany).toHaveBeenCalledTimes(2);
        expect(DocumentModel.coll.deleteMany).toHaveBeenLastCalledWith({
            domainId: "system",
            docType: 71,
            parentType: 70,
            parentId: article.docId,
        });
        expect(DocumentModel.collStatus.deleteMany).toHaveBeenLastCalledWith({
            domainId: "system",
            docType: 71,
            parentId: article.docId,
        });
    });

    it("does not clean comments while article removal is still pending", async () => {
        let removeArticle!: () => void;
        let removalStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            removalStarted = resolve;
        });
        DocumentModel.coll.deleteOne.mockImplementation(
            () =>
                new Promise<{ deletedCount: number }>((resolve) => {
                    removeArticle = () => resolve({ deletedCount: 1 });
                    removalStarted();
                }),
        );
        const deletion = BlogModel.del(article.docId);
        await started;
        const cleanedBeforeRemoval = DocumentModel.coll.deleteMany.mock.calls.length;
        removeArticle();
        await deletion;
        expect(cleanedBeforeRemoval).toBe(0);
        expect(DocumentModel.coll.deleteMany).toHaveBeenCalledOnce();
    });

    it.each([
        [undefined, true],
        [tailId, true],
        [undefined, false],
        [tailId, false],
    ] as const)("rejects a like transition after publication changes during its count write", async (nested, liked) => {
        let releaseCount!: () => void;
        let countStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            countStarted = resolve;
        });
        DocumentModel.collStatus.findOneAndUpdate.mockResolvedValue({ liked: true });
        DocumentModel.collStatus.updateOne.mockResolvedValue({ matchedCount: 1 });
        DocumentModel.coll.updateOne.mockImplementationOnce(() => {
            countStarted();
            return new Promise<{ matchedCount: number }>((resolve) => {
                releaseCount = () => resolve({ matchedCount: 1 });
            });
        });
        const operation = BlogCommentModel.like(article.docId, id, nested, 2, liked);
        const rejected = expect(operation).rejects.toBeInstanceOf(ValidationError);
        await started;
        DocumentModel.get.mockResolvedValue({ ...article, draft: true });
        releaseCount();
        await rejected;
        expect(DocumentModel.coll.updateOne).toHaveBeenLastCalledWith(expect.objectContaining({ docId: id }), {
            $inc: nested ? { "reply.$.nLike": liked ? -1 : 1 } : { nLike: liked ? -1 : 1 },
        });
    });

    it("does not undo a newer transition when compensating a withdrawn-article request", async () => {
        DocumentModel.collStatus.findOneAndUpdate.mockResolvedValue({ liked: true });
        DocumentModel.collStatus.updateOne.mockResolvedValue({ matchedCount: 0 });
        DocumentModel.get.mockResolvedValueOnce(article).mockResolvedValueOnce({ ...article, draft: true });
        await expect(BlogCommentModel.like(article.docId, id, undefined, 2, true)).rejects.toBeInstanceOf(
            ValidationError,
        );
        const change = DocumentModel.collStatus.findOneAndUpdate.mock.calls[0][1] as {
            $set: { transitionId: string };
        };
        expect(DocumentModel.collStatus.updateOne).toHaveBeenCalledWith(
            { domainId: "system", docType: 71, docId: id, uid: 2, transitionId: change.$set.transitionId },
            { $set: { liked: false }, $unset: { transitionId: "" } },
        );
        expect(DocumentModel.coll.updateOne).toHaveBeenCalledOnce();
    });

    it.each([undefined, tailId])("changes like counts only after an actual user-state transition", async (nested) => {
        DocumentModel.collStatus.findOneAndUpdate.mockResolvedValueOnce({ liked: true }).mockResolvedValueOnce(null);
        DocumentModel.collStatus.findOne.mockResolvedValue({ liked: true });
        await BlogCommentModel.like(article.docId, id, nested, 2, true);
        await BlogCommentModel.like(article.docId, id, nested, 2, true);
        expect(DocumentModel.coll.updateOne).toHaveBeenCalledTimes(1);
        expect(DocumentModel.coll.updateOne).toHaveBeenCalledWith(expect.objectContaining({ docId: id }), {
            $inc: nested ? { "reply.$.nLike": 1 } : { nLike: 1 },
        });
        expect(DocumentModel.collStatus.findOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ docId: nested || id, uid: 2 }),
            {
                $set: {
                    liked: true,
                    parentId: article.docId,
                    commentId: id,
                    transitionId: expect.any(String) as unknown,
                },
            },
            { upsert: true, returnDocument: "after" },
        );
    });

    it("does not create status or decrement for an initial unlike", async () => {
        DocumentModel.collStatus.findOneAndUpdate.mockResolvedValue(null);
        await expect(BlogCommentModel.like(article.docId, id, tailId, 2, false)).resolves.toMatchObject({
            liked: false,
            nLike: 0,
        });
        expect(DocumentModel.collStatus.findOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ liked: true }),
            expect.anything(),
            { upsert: false, returnDocument: "after" },
        );
        expect(DocumentModel.coll.updateOne).not.toHaveBeenCalled();
    });

    it("treats duplicate like races as no-ops but propagates genuine database errors", async () => {
        DocumentModel.collStatus.findOneAndUpdate.mockRejectedValueOnce(
            Object.assign(new Error("duplicate"), { code: 11000 }),
        );
        await BlogCommentModel.like(article.docId, id, undefined, 2, true);
        expect(DocumentModel.coll.updateOne).not.toHaveBeenCalled();
        const failure = new Error("offline");
        DocumentModel.collStatus.findOneAndUpdate.mockRejectedValue(failure);
        await expect(BlogCommentModel.like(article.docId, id, undefined, 2, true)).rejects.toBe(failure);
    });

    it("cleans a newly created like status when its target was concurrently deleted", async () => {
        DocumentModel.collStatus.findOneAndUpdate.mockResolvedValue({ liked: true });
        DocumentModel.coll.updateOne.mockResolvedValue({ matchedCount: 0 });
        await expect(BlogCommentModel.like(article.docId, id, tailId, 2, true)).rejects.toBeInstanceOf(
            DocumentNotFoundError,
        );
        expect(DocumentModel.collStatus.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ docId: tailId }));
    });
});

describe("comment handler protocol", () => {
    it.each([
        ["postReply", { content: "@[](/user/1) denied mention" }],
        ["postTailReply", { drid: id.toHexString(), content: "@[](/user/1) denied mention" }],
        ["postLike", { drid: id.toHexString(), liked: true }],
        ["postLike", { drid: id.toHexString(), drrid: tailId.toHexString(), liked: false }],
        ["postDeleteReply", { drid: id.toHexString() }],
        ["postDeleteTailReply", { drid: id.toHexString(), drrid: tailId.toHexString() }],
    ] as const)("rejects %s on an unreadable draft before target lookup or side effects", async (operation, args) => {
        const h = handler(2);
        h.ddoc = { ...article, draft: true };
        const call = h[operation].bind(h) as unknown as (args: Record<string, unknown>) => Promise<void>;
        await expect(dispatchHandler(h, "post", () => call({ domainId: "system", ...args }))).rejects.toBeInstanceOf(
            BlogPermissionError,
        );
        expect(DocumentModel.coll.findOne).not.toHaveBeenCalled();
        for (const effect of [
            DocumentModel.add,
            DocumentModel.push,
            DocumentModel.coll.updateOne,
            DocumentModel.coll.findOneAndDelete,
            DocumentModel.collStatus.findOneAndUpdate,
            UserModel.getList,
            MessageModel.send,
            OplogModel.log,
        ]) {
            expect(effect).not.toHaveBeenCalled();
        }
    });

    it("loads both comment levels with user-specific likes, deletion controls and legacy empty replies", async () => {
        const h = handler(2);
        const legacy = { ...comment(), _id: new ObjectId(), docId: new ObjectId(), owner: 3 };
        delete legacy.reply;
        const comments = [comment(), legacy];
        const cursor = { sort: vi.fn(), project: vi.fn() };
        cursor.sort.mockReturnValue(cursor);
        cursor.project.mockReturnValue(cursor);
        DocumentModel.getMulti.mockReturnValue(cursor);
        const paginate = vi.fn().mockResolvedValue([comments, 2, 4]);
        Object.assign(h, { paginate });
        const statuses = { project: vi.fn(), toArray: vi.fn().mockResolvedValue([{ docId: tailId }]) };
        statuses.project.mockReturnValue(statuses);
        DocumentModel.collStatus.find.mockReturnValue(statuses);
        const users = { 2: makeUser(2), 3: makeUser(3) };
        UserModel.getList.mockResolvedValue(users);

        const result = await h.loadComments(2);

        expect(DocumentModel.getMulti).toHaveBeenCalledWith("system", 71, { parentType: 70, parentId: article.docId });
        expect(cursor.sort).toHaveBeenCalledWith({ _id: -1 });
        expect(cursor.project).toHaveBeenCalledWith({ ip: 0, "reply.ip": 0 });
        expect(paginate).toHaveBeenCalledWith(cursor, 2, "reply");
        expect(UserModel.getList).toHaveBeenCalledWith("system", [2, 3]);
        expect(DocumentModel.collStatus.find).toHaveBeenCalledWith({
            domainId: "system",
            docType: 71,
            parentId: article.docId,
            docId: { $in: [id, tailId, legacy.docId] },
            uid: 2,
            liked: true,
        });
        expect(result).toMatchObject({
            comments: [
                { canDelete: true, reply: [{ canDelete: false }] },
                { canDelete: false, reply: [] },
            ],
            commentUsers: users,
            liked: { [tailId.toHexString()]: true },
            page: 2,
            pcount: 2,
            drcount: 4,
            canComment: true,
        });
        expect(comments[0]).not.toHaveProperty("canDelete");
        expect(legacy).not.toHaveProperty("reply");
    });

    it.each(["postReply", "postTailReply"] as const)("returns the persisted ID after %s", async (operation) => {
        const h = handler();
        const post = vi.spyOn(h, "post");
        const back = vi.spyOn(h, "back");
        UserModel.getList.mockResolvedValue({});
        DocumentModel.push.mockResolvedValue([comment(), tailId]);
        const args = { domainId: "system", content: "  New comment  ", drid: id.toHexString() };
        const call = h[operation].bind(h) as unknown as (args: Record<string, unknown>) => Promise<void>;
        await dispatchHandler(h, "post", () => call(args));
        expect(post).toHaveBeenCalledOnce();
        expect(back).toHaveBeenCalledWith(operation === "postReply" ? { drid: id } : { drrid: tailId });
        if (operation === "postTailReply") {
            expect(DocumentModel.push).toHaveBeenCalledWith("system", 71, id, "reply", "New comment", 2, {
                ip: "192.0.2.1",
                nLike: 0,
            });
        } else {
            expect(DocumentModel.add.mock.calls[0][1]).toBe("New comment");
        }
    });

    it("notifies and audits nested moderation without truncating short content", async () => {
        const h = handler(4, -1n);
        const target = comment();
        target.reply![0].content = "Short";
        DocumentModel.coll.findOne.mockResolvedValue(target);
        const back = vi.spyOn(h, "back");
        await dispatchHandler(h, "post", () => h.postDeleteTailReply(undefined, id, tailId));
        expect(DocumentModel.coll.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({ docId: id, "reply._id": tailId }),
            { $pull: { reply: { _id: tailId } } },
        );
        expect(JSON.parse(MessageModel.send.mock.calls[0][2] as string)).toMatchObject({
            params: ["user4", "Short", "Test post", "/blog_post_detail"],
        });
        expect(MessageModel.send.mock.calls[0][1]).toBe(3);
        expect(OplogModel.log).toHaveBeenCalledWith(h, "blog.tailReply.delete", target.reply![0]);
        expect(back).toHaveBeenCalledOnce();
    });

    it.each([
        ["postReply", { content: "" }],
        ["postTailReply", { drid: "bad", content: "text" }],
        ["postDeleteReply", { drid: "bad" }],
        ["postDeleteTailReply", { drid: id.toHexString(), drrid: "bad" }],
        ["postLike", { drid: id.toHexString() }],
        ["postLike", { drid: id.toHexString(), liked: null }],
    ] as const)("validates %s before messages or writes", async (operation, args) => {
        const h = handler();
        const call = h[operation].bind(h) as unknown as (args: Record<string, unknown>) => Promise<void>;
        await expect(async () => call.call(h, { domainId: "system", ...args })).rejects.toBeInstanceOf(ValidationError);
        expect(MessageModel.send).not.toHaveBeenCalled();
        expect(DocumentModel.add).not.toHaveBeenCalled();
    });

    it.each([true, false, 0])("accepts explicit like state %s with real Hydro conversion", async (liked) => {
        const h = handler();
        const write = vi.spyOn(BlogCommentModel, "like").mockResolvedValue({ drid: id, nLike: 0, liked: !!liked });
        const call = h.postLike.bind(h) as unknown as (args: Record<string, unknown>) => Promise<void>;
        await call.call(h, { domainId: "system", drid: id.toHexString(), liked });
        expect(write).toHaveBeenCalledWith(article.docId, id, undefined, 2, !!liked);
    });

    it("notifies mentions before persistence, deduplicating targets without readability filtering", async () => {
        const h = handler();
        const limiter = vi.spyOn(h, "limitRate");
        const calls: string[] = [];
        MessageModel.send.mockImplementation(() => {
            calls.push("message");
        });
        vi.spyOn(BlogCommentModel, "add").mockImplementation(() => {
            calls.push("write");
            return Promise.reject(new Error("write failed"));
        });
        await expect(h.postReply(undefined, "@[](/user/3) @[](/user/3)")).rejects.toThrow("write failed");
        expect(MessageModel.send).toHaveBeenCalledExactlyOnceWith(1, [3], expect.any(String), 5);
        expect(calls).toEqual(["message", "write"]);
        expect(limiter).toHaveBeenCalledWith("add_blog_comment", 3600, 60);
        expect(OplogModel.log).not.toHaveBeenCalled();
    });

    it("rejects foreign/missing reply targets before mentions", async () => {
        DocumentModel.coll.findOne.mockResolvedValue(null);
        await expect(handler().postTailReply(undefined, id, "@[](/user/3)")).rejects.toThrow();
        expect(MessageModel.send).not.toHaveBeenCalled();
    });

    it("retains native deletion notices and deletion-only audits", async () => {
        const h = handler(1);
        const post = vi.spyOn(h, "post");
        const deleted = vi.spyOn(BlogCommentModel, "delete").mockResolvedValue();
        await dispatchHandler(h, "post", () => h.postDeleteReply(undefined, id));
        expect(post).toHaveBeenCalledOnce();
        expect(deleted).toHaveBeenCalledWith(article.docId, id, undefined);
        expect(MessageModel.send).toHaveBeenCalledWith(1, 2, expect.stringContaining("Comment co..."), 5);
        expect(OplogModel.log).toHaveBeenCalledWith(h, "blog.reply.delete", expect.objectContaining({ owner: 2 }));
    });

    it("does not notify for self deletion and denies author moderation of nested replies", async () => {
        vi.spyOn(BlogCommentModel, "delete").mockResolvedValue();
        await handler(2).postDeleteReply(undefined, id);
        expect(MessageModel.send).not.toHaveBeenCalled();
        await expect(handler(1).postDeleteTailReply(undefined, id, tailId)).rejects.toThrow();
    });

    it("rejects likes on drafts even for root while allowing authorized deletion", async () => {
        const h = handler(1, -1n);
        h.ddoc = { ...article, draft: true };
        await expect(h.postLike(undefined, id, undefined, true)).rejects.toThrow();
        vi.spyOn(BlogCommentModel, "delete").mockResolvedValue();
        await h.postDeleteReply(undefined, id);
        expect(DocumentModel.collStatus.findOneAndUpdate).not.toHaveBeenCalled();
    });
});
