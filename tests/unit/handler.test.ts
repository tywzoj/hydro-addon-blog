import type { Context } from "hydrooj";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyHandler } from "../../features/handler";
import { BLOG_DEFAULT, BLOG_PERM, BlogPermissionError, BlogPolicy } from "../../features/permission";
import { BlogSettingsModel, initialSettings, resolveBlogPolicy } from "../../features/settings.model";
import type { BlogStatusDoc } from "../../features/types";
import { makeBlog } from "../helpers/fixtures";
import type { Handler } from "../helpers/hydro";
import {
    DiscussionNotFoundError,
    DocumentModel,
    makeUser,
    OplogModel,
    PRIV,
    PrivilegeError,
    UserModel,
    UserNotFoundError,
    ValidationError,
} from "../helpers/hydro";

type Args = Record<string, unknown>;

interface UnitHandler extends Handler {
    blog: BlogPolicy;
    get: (args?: Args) => Promise<void> | void;
    post: () => void;
    postStar: (args: Args) => Promise<void>;
    postSubmit: (args: Args) => Promise<void>;
    postDelete: () => Promise<void>;
    postPin: (args: Args) => Promise<void>;
    postPublish: (args: Args) => Promise<void>;
    prepare: () => void;
    __prepare: (args: Args) => Promise<void>;
    _prepare: (args: Args) => Promise<void>;
}

const register = vi.fn<(name: string, path: string, Class: new () => UnitHandler, privilege: number) => void>();
applyHandler({ Route: register } as unknown as Context);
const routes = new Map(register.mock.calls.map(([, path, Class, privilege]) => [path, { Class, privilege }]));

function createHandler(path: string, viewer = 1, privileges = PRIV.PRIV_USER_PROFILE) {
    const handler = new (routes.get(path)!.Class)();
    handler.user = makeUser(viewer, privileges);
    handler.udoc = makeUser();
    handler.ddoc = makeBlog({ draft: false });
    handler.blog = resolveBlogPolicy(handler.user, initialSettings());
    handler.ctx.db.paginate.mockResolvedValue([[], 3, 21]);
    return handler;
}

const sort = vi.fn();
const cursor = { sort };
const submit = { domainId: "system", title: "Test post", content: "Test content", draft: "true", pin: "false" };

beforeEach(() => {
    vi.resetAllMocks();
    sort.mockReturnValue(cursor);
    DocumentModel.getMulti.mockReturnValue(cursor);
    UserModel.getList.mockResolvedValue({});
    UserModel.getById.mockResolvedValue(makeUser());
    vi.spyOn(BlogSettingsModel, "forRequest").mockImplementation((handler) =>
        Promise.resolve(resolveBlogPolicy(handler.user, initialSettings())),
    );
    DocumentModel.coll.findOneAndUpdate.mockResolvedValue(makeBlog({ draft: false }));
    DocumentModel.coll.deleteOne.mockResolvedValue({ deletedCount: 1 });
});

describe("route and preparation contracts", () => {
    it("registers create before detail and leaves read admission to blog policy", () => {
        expect([...routes.keys()]).toEqual([
            "/blog",
            "/blog/:uid",
            "/blog/:uid/create",
            "/blog/:uid/:did",
            "/blog/:uid/:did/edit",
        ]);
        for (const route of routes.values()) {
            expect(route.privilege).toBeUndefined();
            expect(new route.Class()).toHaveProperty("noCheckPermView", true);
        }
    });

    it("resolves the target user in the system domain using the real uid converter", async () => {
        const handler = createHandler("/blog/:uid");
        UserModel.getById.mockResolvedValue(makeUser(7));

        await handler.__prepare({ domainId: "system", uid: "7" });

        expect(UserModel.getById).toHaveBeenCalledWith("system", 7);
        expect(handler.udoc._id).toBe(7);
    });

    it("rejects malformed user ids before lookup", async () => {
        await expect(async () =>
            createHandler("/blog/:uid").__prepare({ domainId: "system", uid: "invalid" }),
        ).rejects.toBeInstanceOf(ValidationError);
        expect(UserModel.getById).not.toHaveBeenCalled();
    });

    it("rejects a missing target user", async () => {
        UserModel.getById.mockResolvedValue(null);
        await expect(createHandler("/blog/:uid").__prepare({ domainId: "system", uid: "7" })).rejects.toBeInstanceOf(
            UserNotFoundError,
        );
    });

    it("loads a post only when it belongs to the URL user", async () => {
        const handler = createHandler("/blog/:uid/:did");
        DocumentModel.get.mockResolvedValue(handler.ddoc);
        await handler._prepare({ domainId: "system", did: handler.ddoc.docId.toHexString() });
        expect(DocumentModel.get).toHaveBeenCalledWith("system", 70, handler.ddoc.docId);
        expect(handler.ddoc.owner).toBe(handler.udoc._id);
    });

    it.each([null, makeBlog({ owner: 7 })])("rejects a missing post or mismatched URL user", async (doc) => {
        const handler = createHandler("/blog/:uid/:did");
        DocumentModel.get.mockResolvedValue(doc);
        await expect(
            handler._prepare({ domainId: "system", did: handler.ddoc.docId.toHexString() }),
        ).rejects.toBeInstanceOf(DiscussionNotFoundError);
    });

    it("rejects malformed post ids before persistence", async () => {
        await expect(async () =>
            createHandler("/blog/:uid/:did")._prepare({ domainId: "system", did: "invalid" }),
        ).rejects.toBeInstanceOf(ValidationError);
        expect(DocumentModel.get).not.toHaveBeenCalled();
    });
});

describe("list query contracts", () => {
    it("excludes drafts on home even for a system editor, with no pin precedence", async () => {
        const handler = createHandler("/blog", 1, PRIV.PRIV_USER_PROFILE | PRIV.PRIV_EDIT_SYSTEM);
        const doc = makeBlog({ draft: false });
        handler.ctx.db.paginate.mockResolvedValue([[doc], 3, 21]);

        await handler.get({ domainId: "system" });

        expect(DocumentModel.getMulti).toHaveBeenCalledWith("system", 70, { draft: { $ne: true } });
        expect(sort).toHaveBeenLastCalledWith({ firstPublishAt: -1 });
        expect(handler.ctx.db.paginate).toHaveBeenCalledWith(cursor, 1, 10);
        expect(UserModel.getList).toHaveBeenCalledWith("system", [doc.owner]);
        expect(handler.response).toMatchObject({
            template: "blog_main.html",
            body: { scenario: "home", ddocs: [doc], dpcount: 3, page: 1, sort: "latest" },
        });
    });

    it.each([
        [2, PRIV.PRIV_USER_PROFILE, { owner: 1, draft: { $ne: true } }, { pin: -1, firstPublishAt: -1 }, false],
        [1, PRIV.PRIV_USER_PROFILE, { owner: 1 }, { pin: -1, updateAt: -1 }, true],
        [2, PRIV.PRIV_USER_PROFILE | PRIV.PRIV_EDIT_SYSTEM, { owner: 1 }, { pin: -1, updateAt: -1 }, false],
    ])(
        "selects user-list visibility and default sorting for viewer %s with privileges %s",
        async (viewer, privileges, query, order, isOwner) => {
            const handler = createHandler("/blog/:uid", viewer, privileges);
            await handler.get({ domainId: "system" });
            expect(DocumentModel.getMulti).toHaveBeenCalledWith("system", 70, query);
            expect(sort).toHaveBeenLastCalledWith(order);
            expect(handler.response.body).toMatchObject({ scenario: "user", is_owner: isOwner });
        },
    );

    it.each([
        ["latest", { firstPublishAt: -1 }],
        ["latest_update", { updateAt: -1 }],
        ["views", { views: -1 }],
    ])("honors explicit %s ordering and converts page input", async (key, order) => {
        for (const path of ["/blog", "/blog/:uid"]) {
            const handler = createHandler(path, 2);
            await handler.get({ domainId: "system", page: "2", sort: key });
            expect(sort).toHaveBeenLastCalledWith(path === "/blog" ? order : { pin: -1, ...order });
            expect(handler.ctx.db.paginate).toHaveBeenCalledWith(cursor, 2, 10);
        }
    });

    it.each([{ page: "0" }, { page: "-1" }, { page: "1.5" }, { sort: "unsupported" }, { domainId: "" }])(
        "rejects invalid list parameters %j before querying",
        async (args) => {
            for (const path of ["/blog", "/blog/:uid"]) {
                await expect(async () =>
                    createHandler(path).get({ domainId: "system", ...args }),
                ).rejects.toBeInstanceOf(ValidationError);
            }
            expect(DocumentModel.getMulti).not.toHaveBeenCalled();
        },
    );
});

describe("write authorization contracts", () => {
    it.each(["/blog/:uid/create", "/blog/:uid/:did/edit"])(
        "requires the operation's others permission at %s",
        (path) => {
            const handler = createHandler(path, 2);
            expect(() => (path.endsWith("/edit") ? handler.get() : handler.prepare())).toThrow(BlogPermissionError);
            expect(DocumentModel.add).not.toHaveBeenCalled();
            expect(DocumentModel.set).not.toHaveBeenCalled();
            expect(DocumentModel.deleteOne).not.toHaveBeenCalled();
        },
    );

    it.each(["/blog/:uid/create", "/blog/:uid/:did/edit"])(
        "allows the owner and delegates the system-editor path at %s",
        (path) => {
            const owner = createHandler(path);
            expect(() => owner.prepare()).not.toThrow();
            expect(owner.checkPriv).not.toHaveBeenCalled();
            const editor = createHandler(path, 2, PRIV.PRIV_USER_PROFILE | PRIV.PRIV_EDIT_SYSTEM);
            expect(() => editor.prepare()).not.toThrow();
            expect(editor.blog.role).toBe("root");
        },
    );
});

describe("create, edit, and delete contracts", () => {
    it("creates with converted fields, limits before writing, and logs before redirecting", async () => {
        const handler = createHandler("/blog/:uid/create");
        DocumentModel.add.mockResolvedValue(handler.ddoc.docId);
        await handler.postSubmit({ ...submit, pin: "true" });

        expect(handler.limitRate).toHaveBeenCalledWith("add_blog", 3600, 60);
        expect(DocumentModel.add).toHaveBeenCalledWith(
            "system",
            "Test content",
            1,
            70,
            null,
            null,
            null,
            expect.objectContaining({ title: "Test post", draft: true, pin: true, ip: "192.0.2.1" }),
        );
        expect(OplogModel.log).toHaveBeenCalledWith(handler, "blog.create", { did: handler.ddoc.docId });
        expect(handler.limitRate.mock.invocationCallOrder[0]).toBeLessThan(
            DocumentModel.add.mock.invocationCallOrder[0],
        );
        expect(DocumentModel.add.mock.invocationCallOrder[0]).toBeLessThan(OplogModel.log.mock.invocationCallOrder[0]);
        expect(handler.response.redirect).toBe("/blog_post_detail");
        expect(handler.url).toHaveBeenCalledWith("blog_post_detail", { uid: 1, did: handler.ddoc.docId });
    });

    it("defaults omitted creation booleans to a draft without pinning", async () => {
        const handler = createHandler("/blog/:uid/create");
        DocumentModel.add.mockResolvedValue(handler.ddoc.docId);
        await handler.postSubmit({ domainId: "system", title: "Title", content: " Content " });
        expect(DocumentModel.add).toHaveBeenCalledWith(
            "system",
            "Content",
            1,
            70,
            null,
            null,
            null,
            expect.objectContaining({ draft: true, pin: false }),
        );
    });

    it("treats a visible unchecked draft checkbox as an explicit publication request", async () => {
        const handler = createHandler("/blog/:uid/create");
        DocumentModel.add.mockResolvedValue(handler.ddoc.docId);
        await handler.postSubmit({
            domainId: "system",
            title: "Public post",
            content: "Body",
            draft_present: "true",
        });
        expect(DocumentModel.add.mock.calls[0][7]).toMatchObject({ draft: false });
        handler.blog = new BlogPolicy(handler.user, "restricted", BLOG_DEFAULT & ~BLOG_PERM.PUBLISH_OWN);
        await expect(
            handler.postSubmit({
                domainId: "system",
                title: "Public post",
                content: "Body",
                draft_present: "true",
            }),
        ).rejects.toBeInstanceOf(BlogPermissionError);
    });

    it.each([{ title: " " }, { title: "x".repeat(65) }, { content: " " }, { content: "x".repeat(65536) }])(
        "rejects invalid fields before mutation or side effects",
        async (invalid) => {
            for (const path of ["/blog/:uid/create", "/blog/:uid/:did/edit"]) {
                const handler = createHandler(path);
                await expect(async () => handler.postSubmit({ ...submit, ...invalid })).rejects.toBeInstanceOf(
                    ValidationError,
                );
                expect(handler.limitRate).not.toHaveBeenCalled();
            }
            expect(DocumentModel.add).not.toHaveBeenCalled();
            expect(DocumentModel.set).not.toHaveBeenCalled();
            expect(OplogModel.log).not.toHaveBeenCalled();
        },
    );

    it("does not write or log when the creation rate limiter rejects", async () => {
        const handler = createHandler("/blog/:uid/create");
        const failure = new Error("Rate limited");
        handler.limitRate.mockRejectedValue(failure);
        await expect(handler.postSubmit(submit)).rejects.toBe(failure);
        expect(DocumentModel.add).not.toHaveBeenCalled();
        expect(OplogModel.log).not.toHaveBeenCalled();
        expect(handler.response.redirect).toBeUndefined();
    });

    it("does not log or redirect after a creation write fails", async () => {
        const handler = createHandler("/blog/:uid/create");
        const failure = new Error("Write failed");
        DocumentModel.add.mockRejectedValue(failure);
        await expect(handler.postSubmit(submit)).rejects.toBe(failure);
        expect(OplogModel.log).not.toHaveBeenCalled();
        expect(handler.response.redirect).toBeUndefined();
    });

    it("does not report creation success if its audit log fails", async () => {
        const handler = createHandler("/blog/:uid/create");
        const failure = new Error("Audit unavailable");
        DocumentModel.add.mockResolvedValue(handler.ddoc.docId);
        OplogModel.log.mockRejectedValue(failure);
        await expect(handler.postSubmit(submit)).rejects.toBe(failure);
        expect(DocumentModel.add).toHaveBeenCalledOnce();
        expect(handler.response.redirect).toBeUndefined();
        expect(handler.response.body).toBeUndefined();
    });

    it("updates the post, records the edit, and redirects to its detail page", async () => {
        const handler = createHandler("/blog/:uid/:did/edit");
        DocumentModel.coll.findOneAndUpdate.mockResolvedValue(handler.ddoc);
        await handler.postSubmit({ ...submit, draft: "false", pin: "true" });
        expect(DocumentModel.coll.findOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                domainId: "system",
                docType: 70,
                docId: handler.ddoc.docId,
                updateAt: handler.ddoc.updateAt,
            }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    title: "Test post",
                    content: "Test content",
                    draft: false,
                    pin: true,
                    ip: "192.0.2.1",
                }) as unknown,
            }),
            { returnDocument: "after" },
        );
        expect(OplogModel.log).toHaveBeenCalledWith(handler, "blog.edit", handler.ddoc);
        expect(handler.response.redirect).toBe("/blog_post_detail");
    });

    it("deletes the post and statuses, logs the operation, and redirects to the author's list", async () => {
        const handler = createHandler("/blog/:uid/:did/edit");
        await handler.postDelete();
        expect(DocumentModel.coll.deleteOne).toHaveBeenCalledWith(
            expect.objectContaining({ domainId: "system", docType: 70, docId: handler.ddoc.docId }),
        );
        expect(DocumentModel.deleteMultiStatus).toHaveBeenCalledWith("system", 70, { docId: handler.ddoc.docId });
        expect(OplogModel.log).toHaveBeenCalledWith(handler, "blog.delete", handler.ddoc);
        expect(handler.url).toHaveBeenCalledWith("blog_list_user", { uid: 1 });
        expect(handler.response.redirect).toBe("/blog_list_user");
    });

    it("does not log or redirect after an edit fails", async () => {
        const handler = createHandler("/blog/:uid/:did/edit");
        const failure = new Error("Write failed");
        DocumentModel.coll.findOneAndUpdate.mockRejectedValue(failure);
        await expect(handler.postSubmit(submit)).rejects.toBe(failure);
        expect(handler.response.redirect).toBeUndefined();
        expect(handler.response.body).toBeUndefined();
    });

    it("does not report success when deletion or its operation log fails", async () => {
        const failure = new Error("Audit unavailable");
        OplogModel.log.mockRejectedValue(failure);
        const handler = createHandler("/blog/:uid/:did/edit");
        await expect(handler.postDelete()).rejects.toBe(failure);
        expect(handler.response.redirect).toBeUndefined();
    });

    it("renders distinct create and edit forms", async () => {
        const create = createHandler("/blog/:uid/create");
        const edit = createHandler("/blog/:uid/:did/edit");
        await create.get();
        await edit.get();
        expect(create.response).toMatchObject({ template: "blog_edit.html", body: { ddoc: null } });
        expect(edit.response).toMatchObject({ template: "blog_edit.html", body: { ddoc: edit.ddoc } });
    });
});

describe("views and star state", () => {
    it("counts the first eligible view, but not a later sequential view with recorded status", async () => {
        const handler = createHandler("/blog/:uid/:did", 2);
        const status: BlogStatusDoc = { docType: 70, docId: handler.ddoc.docId, view: true, star: true };
        DocumentModel.getStatus.mockResolvedValueOnce(null).mockResolvedValueOnce(status);
        DocumentModel.inc.mockResolvedValue(makeBlog({ views: 1 }));
        DocumentModel.setStatus.mockResolvedValue(status);

        await handler.get();
        await handler.get();

        expect(DocumentModel.getStatus).toHaveBeenCalledWith("system", 70, handler.ddoc.docId, 2);
        expect(DocumentModel.inc).toHaveBeenCalledExactlyOnceWith("system", 70, handler.ddoc.docId, "views", 1);
        expect(DocumentModel.setStatus).toHaveBeenCalledExactlyOnceWith("system", 70, handler.ddoc.docId, 2, {
            view: true,
        });
        expect(handler.ddoc.views).toBe(1);
        expect(handler.response).toMatchObject({ template: "blog_detail.html", body: { star: true } });
    });

    it.each([
        [0, PRIV.PRIV_USER_PROFILE],
        [2, 0],
    ])("does not track a view for id=%s with privileges=%s", async (viewer, privileges) => {
        const handler = createHandler("/blog/:uid/:did", viewer, privileges);
        handler.blog = new BlogPolicy(handler.user, "guest", BLOG_PERM.ACCESS | BLOG_PERM.VIEW_PUBLISHED);
        await handler.get();
        expect(DocumentModel.getStatus).not.toHaveBeenCalled();
        expect(DocumentModel.inc).not.toHaveBeenCalled();
        expect(DocumentModel.setStatus).not.toHaveBeenCalled();
        expect(handler.response.body).toMatchObject({ star: false });
    });

    it("propagates a view status failure without presenting a successfully incremented response", async () => {
        const handler = createHandler("/blog/:uid/:did", 2);
        const failure = new Error("Status write failed");
        DocumentModel.getStatus.mockResolvedValue(null);
        DocumentModel.inc.mockResolvedValue(makeBlog({ views: 1 }));
        DocumentModel.setStatus.mockRejectedValue(failure);
        await expect(handler.get()).rejects.toBe(failure);
        expect(handler.ddoc.views).toBe(0);
        expect(handler.response.template).toBeUndefined();
    });

    it.each([
        ["true", true],
        ["false", false],
        ["0", false],
    ])("converts star=%s and updates only the current user's star field", async (value, expected) => {
        const handler = createHandler("/blog/:uid/:did", 2);
        handler.post();
        await handler.postStar({ domainId: "system", star: value });
        expect(DocumentModel.setStatus).toHaveBeenCalledWith("system", 70, handler.ddoc.docId, 2, { star: expected });
        expect(handler.back).toHaveBeenCalledWith({ star: expected });
    });

    describe("fine-grained blog authorization", () => {
        it("denies direct draft reads before tracking views or looking up status", async () => {
            const handler = createHandler("/blog/:uid/:did", 2);
            handler.ddoc.draft = true;
            await expect(handler.get()).rejects.toBeInstanceOf(BlogPermissionError);
            expect(DocumentModel.getStatus).not.toHaveBeenCalled();
            expect(DocumentModel.inc).not.toHaveBeenCalled();
        });

        it("does not let others-edit permission restore revoked own-edit permission", async () => {
            const handler = createHandler("/blog/:uid/:did/edit");
            handler.blog = new BlogPolicy(
                handler.user,
                "custom",
                (BLOG_DEFAULT & ~BLOG_PERM.EDIT_OWN) | BLOG_PERM.EDIT_OTHERS,
            );
            await expect(handler.postSubmit({ ...submit, title: "Changed", draft: "false" })).rejects.toBeInstanceOf(
                BlogPermissionError,
            );
            expect(DocumentModel.coll.findOneAndUpdate).not.toHaveBeenCalled();
        });

        it("requires publication rights for edits that remain public", async () => {
            const handler = createHandler("/blog/:uid/:did/edit");
            handler.blog = new BlogPolicy(handler.user, "custom", BLOG_DEFAULT & ~BLOG_PERM.PUBLISH_OWN);
            await expect(handler.postSubmit({ ...submit, title: "Changed", draft: "false" })).rejects.toBeInstanceOf(
                BlogPermissionError,
            );
            expect(DocumentModel.coll.findOneAndUpdate).not.toHaveBeenCalled();
        });

        it("preserves omitted pin and draft fields on update", async () => {
            const handler = createHandler("/blog/:uid/:did/edit");
            handler.ddoc.pin = true;
            await handler.postSubmit({ domainId: "system", title: "Changed", content: "Body" });
            expect(DocumentModel.coll.findOneAndUpdate).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    $set: expect.objectContaining({ draft: false, pin: true }) as unknown,
                }),
                expect.anything(),
            );
        });

        it("allows independent pinning and deletion without edit permission", async () => {
            const handler = createHandler("/blog/:uid/:did/edit");
            handler.blog = new BlogPolicy(handler.user, "custom", BLOG_DEFAULT & ~BLOG_PERM.EDIT_OWN);
            await handler.postPin({ domainId: "system", pin: "true" });
            await handler.postDelete();
            expect(DocumentModel.coll.findOneAndUpdate).toHaveBeenCalledOnce();
            expect(DocumentModel.coll.deleteOne).toHaveBeenCalledOnce();
        });

        it("does not hide an unauthorized pin change inside an otherwise allowed content edit", async () => {
            const handler = createHandler("/blog/:uid/:did/edit");
            handler.blog = new BlogPolicy(handler.user, "custom", BLOG_DEFAULT & ~BLOG_PERM.PIN_OWN);
            await expect(handler.postSubmit({ ...submit, pin: "true" })).rejects.toBeInstanceOf(BlogPermissionError);
            expect(DocumentModel.coll.findOneAndUpdate).not.toHaveBeenCalled();
        });

        it("rejects stale publication-sensitive updates without logging success", async () => {
            const handler = createHandler("/blog/:uid/:did/edit");
            DocumentModel.coll.findOneAndUpdate.mockResolvedValue(null);
            await expect(handler.postSubmit(submit)).rejects.toBeInstanceOf(ValidationError);
            expect(OplogModel.log).not.toHaveBeenCalled();
        });
    });

    it("requires profile privilege in the detail write hook", () => {
        const handler = createHandler("/blog/:uid/:did", 2, 0);
        expect(() => handler.post()).toThrow(PrivilegeError);
        expect(DocumentModel.setStatus).not.toHaveBeenCalled();
    });
});
