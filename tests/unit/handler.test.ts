import type { Context } from "hydrooj";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BlogConfirmMessages, DEFAULT_REVIEW_SETTINGS, ReviewMessages } from "../../features/constants";
import { applyHandler } from "../../features/handler";
import { BLOG_DEFAULT, BLOG_PERM, BlogPermissionError, BlogPolicy } from "../../features/permission";
import { BlogReviewModel } from "../../features/review.model";
import { BlogSettingsModel, initialSettings, resolveBlogPolicy } from "../../features/settings.model";
import type { BlogDoc, BlogStatusDoc } from "../../features/types";
import { injectUI } from "../../features/ui";
import { makeBlog } from "../helpers/fixtures";
import type { Handler } from "../helpers/hydro";
import {
    DiscussionNotFoundError,
    dispatchHandler,
    DocumentModel,
    ForbiddenError,
    makeUser,
    MessageModel,
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
const project = vi.fn();
const cursor = { sort, project };
const submit = { domainId: "system", title: "Test post", content: "Test content", draft: "true", pin: "false" };

beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(BlogSettingsModel, "review").mockResolvedValue({ ...DEFAULT_REVIEW_SETTINGS });
    sort.mockReturnValue(cursor);
    project.mockReturnValue(cursor);
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
    it("loads home policy through base preparation before admitting access", async () => {
        const handler = createHandler("/blog");
        const forRequest = vi.spyOn(BlogSettingsModel, "forRequest");
        await handler.__prepare({ domainId: "system" });
        expect(forRequest).toHaveBeenCalledWith(handler);
        expect(handler.blog.role).toBe("default");
        forRequest.mockResolvedValue(new BlogPolicy(handler.user, "denied", 0n));
        await expect(handler.__prepare({ domainId: "system" })).rejects.toBeInstanceOf(BlogPermissionError);
    });

    it.each(["disabled", "before", "after"] as const)(
        "gates homepage and dropdown review entries in %s mode",
        async (mode) => {
            vi.spyOn(BlogSettingsModel, "review").mockResolvedValue({ ...DEFAULT_REVIEW_SETTINGS, mode });
            const on = vi.fn<(event: string, listener: (h: UnitHandler) => Promise<void>) => void>();
            const inject = vi.fn();
            injectUI({ on, injectUI: inject } as unknown as Context);
            const handler = createHandler("/blog", 2, PRIV.PRIV_USER_PROFILE | PRIV.PRIV_EDIT_SYSTEM);
            await on.mock.calls[0][1](handler);
            await handler.get({ domainId: "system" });
            expect(handler.response.body?.can_review).toBe(mode !== "disabled");
            const condition = inject.mock.calls.find((args) => args[1] === "blog_review")![3] as (
                h: Handler,
            ) => boolean;
            expect(condition(handler)).toBe(mode !== "disabled");
        },
    );

    it("supplies confirmation translations from each request instead of a shared client catalog", async () => {
        for (const language of ["zh", "ko"]) {
            const handler = createHandler("/blog/:uid");
            vi.spyOn(handler, "translate").mockImplementation((key) => `${language}:${key}`);
            await handler.__prepare({ domainId: "system", uid: "1" });
            expect(handler.UiContext.blogConfirmations).toEqual(
                Object.fromEntries(
                    [...Object.values(BlogConfirmMessages), ReviewMessages.ResetConfirm].map((key) => [
                        key,
                        `${language}:${key}`,
                    ]),
                ),
            );
        }
    });

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
    it.each([
        ["/blog", 0, 0],
        ["/blog", 2, PRIV.PRIV_USER_PROFILE],
        ["/blog/:uid", 1, PRIV.PRIV_USER_PROFILE],
        ["/blog/:uid", 2, PRIV.PRIV_USER_PROFILE | PRIV.PRIV_EDIT_SYSTEM],
        ["/blog/:uid/:did", 1, PRIV.PRIV_USER_PROFILE],
        ["/blog/:uid/:did", 2, PRIV.PRIV_USER_PROFILE],
        ["/blog/:uid/:did/edit", 1, PRIV.PRIV_USER_PROFILE],
        ["/blog/:uid/:did/edit", 2, PRIV.PRIV_USER_PROFILE | PRIV.PRIV_EDIT_SYSTEM],
    ] as const)("omits article and legacy reply IPs at %s for reader %s", async (path, uid, privileges) => {
        const handler = createHandler(path, uid, privileges);
        if (!uid) handler.blog = new BlogPolicy(handler.user, "guest", BLOG_PERM.ACCESS | BLOG_PERM.VIEW_PUBLISHED);
        const doc = makeBlog({
            draft: false,
            ip: "192.0.2.10",
            reply: [{ _id: handler.ddoc.docId, owner: 3, content: "Legacy reply", ip: "192.0.2.11" }],
        });
        handler.ddoc = doc;
        const list = path === "/blog" || path === "/blog/:uid";
        if (list) handler.ctx.db.paginate.mockResolvedValue([[doc], 1, 1]);
        await dispatchHandler(handler, "get", () => handler.get({ domainId: "system" }));
        const body = handler.response.body as { ddoc?: BlogDoc; ddocs?: BlogDoc[] };
        const exposed = list ? body.ddocs![0] : body.ddoc!;
        expect(exposed).not.toHaveProperty("ip");
        expect(exposed.reply[0]).not.toHaveProperty("ip");
        expect(exposed).toMatchObject({ title: doc.title, reply: [{ content: "Legacy reply", owner: 3 }] });
        expect(doc.ip).toBe("192.0.2.10");
        expect(doc.reply[0].ip).toBe("192.0.2.11");
    });

    it("omits IP from a legacy article without creating a reply field", async () => {
        const handler = createHandler("/blog/:uid/:did");
        handler.ddoc = makeBlog({ ip: "192.0.2.12", reply: undefined });
        await handler.get();
        expect(handler.response.body?.ddoc).not.toHaveProperty("ip");
        expect((handler.response.body?.ddoc as BlogDoc).reply).toBeUndefined();
        expect(handler.ddoc.ip).toBe("192.0.2.12");
    });

    it("restricts a draft-only author's list and preserves private projection rules", async () => {
        const handler = createHandler("/blog/:uid");
        handler.blog = new BlogPolicy(handler.user, "draft-reader", BLOG_PERM.ACCESS | BLOG_PERM.VIEW_DRAFT_OWN);
        const doc = makeBlog({ reportCount: 5, rejectionCount: 2 });
        handler.ctx.db.paginate.mockResolvedValue([[doc], 1, 1]);
        await handler.get({ domainId: "system" });
        expect(DocumentModel.getMulti).toHaveBeenCalledWith("system", 70, { owner: 1, draft: true });
        expect(sort).toHaveBeenLastCalledWith({ pin: -1, updateAt: -1 });
        expect(handler.response.body?.ddocs).toEqual([expect.objectContaining({ rejectionCount: 2 })]);
        expect((handler.response.body?.ddocs as unknown[])[0]).not.toHaveProperty("reportCount");
    });

    it.each([true, false])(
        "shows My Blog based on authentication, not create/review grants (%s)",
        async (authenticated) => {
            const handler = createHandler("/blog", authenticated ? 2 : 0, authenticated ? PRIV.PRIV_USER_PROFILE : 0);
            handler.blog = new BlogPolicy(handler.user, "reader", BLOG_PERM.ACCESS | BLOG_PERM.VIEW_PUBLISHED);
            await handler.get({ domainId: "system" });
            expect(handler.response.body).toMatchObject({
                can_my_blog: authenticated,
                can_create: false,
                can_review: false,
            });
        },
    );

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
            expect(handler.response.body).toMatchObject({
                scenario: "user",
                is_owner: isOwner,
                can_create: isOwner,
            });
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
    it.each([
        ["/blog/:uid/create", "postSubmit", submit],
        ["/blog/:uid/:did/edit", "postSubmit", { ...submit, title: "Anonymous update" }],
        ["/blog/:uid/:did/edit", "postDelete", {}],
        ["/blog/:uid/:did/edit", "postPin", { domainId: "system", pin: true }],
        ["/blog/:uid/:did/edit", "postPublish", { domainId: "system", draft: true }],
        ["/blog/:uid/:did", "postStar", { domainId: "system", star: true }],
    ] as const)("requires authentication for %s / %s even with every blog grant", async (path, operation, args) => {
        const handler = createHandler(path, 0, 0);
        handler.blog = new BlogPolicy(handler.user, "guest", -1n);
        await expect(dispatchHandler(handler, "post", () => handler[operation](args))).rejects.toBeInstanceOf(
            PrivilegeError,
        );
        expect(handler.limitRate).not.toHaveBeenCalled();
        for (const write of [
            DocumentModel.add,
            DocumentModel.coll.findOneAndUpdate,
            DocumentModel.coll.deleteOne,
            DocumentModel.setStatus,
            OplogModel.log,
            MessageModel.send,
        ]) {
            expect(write).not.toHaveBeenCalled();
        }
    });

    it.each([
        ["postPublish", { domainId: "system", draft: false }, BLOG_PERM.PUBLISH_OWN, BLOG_PERM.PUBLISH_OTHERS],
        [
            "postSubmit",
            { ...submit, draft: undefined, draft_present: true },
            BLOG_PERM.PUBLISH_OWN,
            BLOG_PERM.PUBLISH_OTHERS,
        ],
        ["postPin", { domainId: "system", pin: true }, BLOG_PERM.PIN_OWN, BLOG_PERM.PIN_OTHERS],
        ["postSubmit", { ...submit, pin: true }, BLOG_PERM.PIN_OWN, BLOG_PERM.PIN_OTHERS],
    ] as const)(
        "does not bypass an own grant through %s or its submission equivalent",
        async (operation, args, own, others) => {
            const handler = createHandler("/blog/:uid/:did/edit");
            handler.ddoc.draft = true;
            const restricted = (BLOG_DEFAULT & ~own & ~BLOG_PERM.EDIT_OWN) | others;
            handler.blog = new BlogPolicy(handler.user, "restricted", restricted);
            await expect(dispatchHandler(handler, "post", () => handler[operation](args))).rejects.toBeInstanceOf(
                BlogPermissionError,
            );
            expect(DocumentModel.coll.findOneAndUpdate).not.toHaveBeenCalled();
            expect(OplogModel.log).not.toHaveBeenCalled();
            handler.blog = new BlogPolicy(handler.user, "permitted", restricted | own);
            await dispatchHandler(handler, "post", () => handler[operation](args));
            expect(DocumentModel.coll.findOneAndUpdate).toHaveBeenCalledOnce();
            expect(OplogModel.log).toHaveBeenCalledOnce();
        },
    );

    it.each(["/blog/:uid/create", "/blog/:uid/:did/edit"])("rejects ordinary non-owner writes at %s", (path) => {
        const handler = createHandler(path, 2);
        expect(() => (path.endsWith("/edit") ? handler.get() : handler.prepare())).toThrow(ForbiddenError);
        expect(DocumentModel.add).not.toHaveBeenCalled();
        expect(DocumentModel.set).not.toHaveBeenCalled();
        expect(DocumentModel.deleteOne).not.toHaveBeenCalled();
    });

    it.each(["/blog/:uid/create", "/blog/:uid/:did/edit"])(
        "allows own operations but delegates only editing to the system editor at %s",
        (path) => {
            const owner = createHandler(path);
            expect(() => owner.prepare()).not.toThrow();
            expect(owner.checkPriv).not.toHaveBeenCalled();
            const editor = createHandler(path, 2, PRIV.PRIV_USER_PROFILE | PRIV.PRIV_EDIT_SYSTEM);
            if (path.endsWith("/edit")) expect(() => editor.prepare()).not.toThrow();
            else expect(() => editor.prepare()).toThrow(ForbiddenError);
            expect(editor.blog.role).toBe("root");
        },
    );
});

describe("create, edit, and delete contracts", () => {
    it("keeps creation attributed to the authenticated user despite forged identity and review fields", async () => {
        const handler = createHandler("/blog/:uid/create");
        DocumentModel.add.mockResolvedValue(handler.ddoc.docId);
        await dispatchHandler(handler, "post", () =>
            handler.postSubmit({
                ...submit,
                uid: 9,
                owner: 9,
                requiresReview: false,
                reportCount: 0,
                writeRevision: 100,
            }),
        );
        const [, , owner, , , , , fields] = DocumentModel.add.mock.calls[0];
        expect(owner).toBe(handler.user._id);
        expect(fields).toMatchObject({ title: submit.title, draft: true });
        for (const field of ["uid", "owner", "requiresReview", "reportCount", "writeRevision"]) {
            expect(fields).not.toHaveProperty(field);
        }
    });

    it("does not apply forged ownership or review resets during an authorized draft edit", async () => {
        const handler = createHandler("/blog/:uid/:did/edit");
        handler.ddoc = makeBlog({ reviewPending: true, requiresReview: true, reportCount: 4, rejectionCount: 2 });
        await dispatchHandler(handler, "post", () =>
            handler.postSubmit({
                ...submit,
                title: "Authorized draft edit",
                owner: 9,
                requiresReview: false,
                reviewPending: false,
                reportCount: 0,
                rejectionCount: 0,
                contentVersion: 999,
                writeRevision: 999,
            }),
        );
        const { $set } = DocumentModel.coll.findOneAndUpdate.mock.calls[0][1] as { $set: Record<string, unknown> };
        expect($set).toMatchObject({
            title: "Authorized draft edit",
            draft: true,
            contentVersion: 1,
            writeRevision: 1,
        });
        for (const field of ["owner", "requiresReview", "reviewPending", "reportCount", "rejectionCount"]) {
            expect($set).not.toHaveProperty(field);
        }
    });

    it("redirects an author without draft-read permission to their list after draft creation", async () => {
        const handler = createHandler("/blog/:uid/create");
        handler.blog = new BlogPolicy(handler.user, "creator", BLOG_DEFAULT & ~BLOG_PERM.VIEW_DRAFT_OWN);
        DocumentModel.add.mockResolvedValue(handler.ddoc.docId);
        await dispatchHandler(handler, "post", () => handler.postSubmit(submit));
        expect(handler.response.redirect).toBe("/blog_list_user");
        expect(OplogModel.log).toHaveBeenCalledOnce();
    });

    it("treats an unchanged submission as a redirect without writing or auditing", async () => {
        const handler = createHandler("/blog/:uid/:did/edit");
        await dispatchHandler(handler, "post", () => handler.postSubmit({ ...submit, draft: false }));
        expect(handler.response.redirect).toBe("/blog_post_detail");
        expect(DocumentModel.coll.findOneAndUpdate).not.toHaveBeenCalled();
        expect(OplogModel.log).not.toHaveBeenCalled();
    });

    it("interprets visible unchecked edit controls as publication and unpinning", async () => {
        const handler = createHandler("/blog/:uid/:did/edit");
        handler.ddoc = makeBlog({ pin: true });
        await dispatchHandler(handler, "post", () =>
            handler.postSubmit({
                domainId: "system",
                title: handler.ddoc.title,
                content: handler.ddoc.content,
                draft_present: true,
                pin_present: true,
            }),
        );
        expect(DocumentModel.coll.findOneAndUpdate).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ $set: expect.objectContaining({ draft: false, pin: false }) as unknown }),
            { returnDocument: "after" },
        );
    });

    it.each([true, false])("allows independent publication state draft=%s without edit permission", async (draft) => {
        const handler = createHandler("/blog/:uid/:did/edit");
        handler.blog = new BlogPolicy(handler.user, "publisher", BLOG_DEFAULT & ~BLOG_PERM.EDIT_OWN);
        handler.ddoc = makeBlog({ draft: !draft, reviewPending: true });
        await dispatchHandler(handler, "post", () => handler.postPublish({ domainId: "system", draft }));
        expect(DocumentModel.coll.findOneAndUpdate).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                $set: expect.objectContaining({ draft, ...(draft ? { reviewPending: false } : {}) }) as unknown,
            }),
            { returnDocument: "after" },
        );
        expect(OplogModel.log).toHaveBeenCalledOnce();
    });

    it("redirects to the author's list when a successful withdrawal removes read access", async () => {
        const handler = createHandler("/blog/:uid/:did/edit");
        handler.blog = new BlogPolicy(handler.user, "publisher", BLOG_DEFAULT & ~BLOG_PERM.VIEW_DRAFT_OWN);
        DocumentModel.coll.findOneAndUpdate.mockResolvedValue(makeBlog({ draft: true }));
        await dispatchHandler(handler, "post", () => handler.postPublish({ domainId: "system", draft: true }));
        expect(handler.response.redirect).toBe("/blog_list_user");
        expect(OplogModel.log).toHaveBeenCalledOnce();
    });

    it.each([
        { mode: "before", draft: false, requiresReview: false, expected: true },
        { mode: "disabled", draft: true, requiresReview: true, expected: true },
        { mode: "after", draft: true, requiresReview: false, expected: false },
    ])(
        "renders the editor's review requirement for $mode / hold=$requiresReview",
        async ({ mode, draft, requiresReview, expected }) => {
            const handler = createHandler("/blog/:uid/:did/edit");
            handler.UiContext.blogReviewMode = mode;
            handler.ddoc = makeBlog({ draft, requiresReview });
            await dispatchHandler(handler, "get", () => handler.get());
            expect(handler.response.body?.publishRequiresReview).toBe(expected);
        },
    );

    it("rejects system-editor creation for another user before rate limiting or writes", async () => {
        const handler = createHandler("/blog/:uid/create", 2, PRIV.PRIV_USER_PROFILE | PRIV.PRIV_EDIT_SYSTEM);
        await expect(dispatchHandler(handler, "post", () => handler.postSubmit(submit))).rejects.toBeInstanceOf(
            ForbiddenError,
        );
        expect(handler.limitRate).not.toHaveBeenCalled();
        expect(DocumentModel.add).not.toHaveBeenCalled();
        expect(OplogModel.log).not.toHaveBeenCalled();
    });

    it("creates with converted fields, limits before writing, and logs before redirecting", async () => {
        const handler = createHandler("/blog/:uid/create");
        const prepare = vi.spyOn(handler, "prepare");
        DocumentModel.add.mockResolvedValue(handler.ddoc.docId);
        await dispatchHandler(handler, "post", () => handler.postSubmit({ ...submit, pin: "true" }));
        expect(prepare).toHaveBeenCalledOnce();

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

    it.each([false, 0])("preserves explicit JSON %s when creating a published article", async (value) => {
        const handler = createHandler("/blog/:uid/create");
        DocumentModel.add.mockResolvedValue(handler.ddoc.docId);
        await handler.postSubmit({ ...submit, draft: value, pin: value });
        expect(DocumentModel.add.mock.calls[0][7]).toMatchObject({ draft: false, pin: false });
    });

    it.each([false, 0])("enforces publication permission for explicit JSON %s", async (value) => {
        const handler = createHandler("/blog/:uid/create");
        handler.blog = new BlogPolicy(handler.user, "restricted", BLOG_DEFAULT & ~BLOG_PERM.PUBLISH_OWN);
        await expect(handler.postSubmit({ ...submit, draft: value })).rejects.toBeInstanceOf(BlogPermissionError);
        expect(DocumentModel.add).not.toHaveBeenCalled();
    });

    it.each([false, 0])("publishes and unpins existing articles with explicit JSON %s", async (value) => {
        const handler = createHandler("/blog/:uid/:did/edit");
        handler.ddoc.draft = true;
        handler.ddoc.pin = true;
        await handler.postSubmit({ ...submit, draft: value, pin: value });
        expect(DocumentModel.coll.findOneAndUpdate).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ $set: expect.objectContaining({ draft: false, pin: false }) as unknown }),
            expect.anything(),
        );
    });

    it.each([false, 0])("unpins through the metadata action with explicit JSON %s", async (value) => {
        const handler = createHandler("/blog/:uid/:did/edit");
        handler.ddoc.pin = true;
        await handler.postPin({ domainId: "system", pin: value });
        expect(DocumentModel.coll.findOneAndUpdate).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ $set: expect.objectContaining({ pin: false }) as unknown }),
            expect.anything(),
        );
    });

    it.each([undefined, null, ""])("requires explicit state for independent actions (%s)", async (value) => {
        for (const [method, field] of [
            ["postPublish", "draft"],
            ["postPin", "pin"],
            ["postStar", "star"],
        ] as const) {
            const handler = createHandler(method === "postStar" ? "/blog/:uid/:did" : "/blog/:uid/:did/edit");
            handler.ddoc.draft = true;
            handler.ddoc.pin = true;
            await expect(async () => handler[method]({ domainId: "system", [field]: value })).rejects.toBeInstanceOf(
                ValidationError,
            );
        }
        expect(DocumentModel.coll.findOneAndUpdate).not.toHaveBeenCalled();
        expect(DocumentModel.setStatus).not.toHaveBeenCalled();
        expect(OplogModel.log).not.toHaveBeenCalled();
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
        handler.ddoc.ip = "192.0.2.13";
        const prepare = vi.spyOn(handler, "prepare");
        DocumentModel.coll.findOneAndUpdate.mockResolvedValue(handler.ddoc);
        await dispatchHandler(handler, "post", () => handler.postSubmit({ ...submit, draft: "false", pin: "true" }));
        expect(prepare).toHaveBeenCalledOnce();
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
        handler.ddoc.ip = "192.0.2.14";
        const prepare = vi.spyOn(handler, "prepare");
        await dispatchHandler(handler, "post", () => handler.postDelete());
        expect(prepare).toHaveBeenCalledOnce();
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
    it("does not block a legacy author's draft when review counters are absent", async () => {
        const handler = createHandler("/blog/:uid/:did");
        handler.ddoc = makeBlog();
        await handler.get();
        expect(handler.response.body).toMatchObject({
            reviewBlocked: false,
            publishRequiresReview: false,
            canReview: false,
            canReset: false,
        });
        expect(handler.response.body?.ddoc).not.toHaveProperty("rejectionCount");
    });

    it.each([false, true])("exposes report controls only without an existing receipt (%s)", async (reported) => {
        vi.spyOn(BlogSettingsModel, "review").mockResolvedValue({ ...DEFAULT_REVIEW_SETTINGS, mode: "after" });
        const findReceipt = vi
            .spyOn(BlogReviewModel.reports, "findOne")
            .mockResolvedValue(reported ? { _id: "receipt" } : null);
        const handler = createHandler("/blog/:uid/:did", 2);
        handler.ddoc.contentVersion = 4;
        DocumentModel.getStatus.mockResolvedValue({ docType: 70, docId: handler.ddoc.docId, view: true });
        await handler.get({ domainId: "system" });
        expect(findReceipt).toHaveBeenCalledWith({
            _id: `system:70:${handler.ddoc.docId.toHexString()}:4:2`,
        });
        expect(handler.response.body).toMatchObject({ canReport: !reported, reportVersion: 4, star: false });
        expect(DocumentModel.inc).not.toHaveBeenCalled();
    });

    it("hides reporting controls for an approved content version", async () => {
        vi.spyOn(BlogSettingsModel, "review").mockResolvedValue({ ...DEFAULT_REVIEW_SETTINGS, mode: "after" });
        const findReceipt = vi.spyOn(BlogReviewModel.reports, "findOne");
        const handler = createHandler("/blog/:uid/:did", 2);
        handler.ddoc.reportApprovedVersion = 0;
        await handler.get();
        expect(handler.response.body).toMatchObject({ canReport: false, reportVersion: undefined });
        expect(findReceipt).not.toHaveBeenCalled();
    });

    it.each([
        { mode: "before" as const, requiresReview: false },
        { mode: "after" as const, requiresReview: true },
    ])(
        "shows an owner's review hold, counters and independent reset controls in $mode mode",
        async ({ mode, requiresReview }) => {
            vi.spyOn(BlogSettingsModel, "review").mockResolvedValue({ ...DEFAULT_REVIEW_SETTINGS, mode });
            const handler = createHandler("/blog/:uid/:did");
            handler.blog = new BlogPolicy(
                handler.user,
                "reviewer",
                BLOG_DEFAULT | BLOG_PERM.REVIEW | BLOG_PERM.RESET_REVIEW_COUNTERS,
            );
            handler.ddoc = makeBlog({ reviewPending: true, requiresReview, rejectionCount: 3, reportCount: 5 });
            await handler.get();
            expect(handler.response.body).toMatchObject({
                canReview: true,
                canReset: true,
                canViewReportCount: true,
                canWithdrawReview: true,
                publishRequiresReview: true,
                reviewBlocked: true,
                ddoc: { reportCount: 5, rejectionCount: 3 },
            });
        },
    );

    it.each([
        [BLOG_PERM.UNPUBLISH_OTHERS, true],
        [0n, false],
        [-1n, true],
    ] as const)("derives withdrawal capability without exposing pending metadata (%s)", async (grants, allowed) => {
        const handler = createHandler("/blog/:uid/:did", 2);
        handler.ddoc = makeBlog({ draft: true, reviewPending: true, requiresReview: true });
        handler.blog = new BlogPolicy(
            handler.user,
            "delegate",
            BLOG_PERM.ACCESS | BLOG_PERM.VIEW_DRAFT_OTHERS | grants,
        );
        DocumentModel.getStatus.mockResolvedValue({ docType: 70, docId: handler.ddoc.docId, view: true });
        await dispatchHandler(handler, "get", () => handler.get());
        expect(handler.response.body).toHaveProperty("canWithdrawReview", allowed);
        expect(handler.response.body?.ddoc).not.toHaveProperty("reviewPending");
    });

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
        const post = vi.spyOn(handler, "post");
        await dispatchHandler(handler, "post", () => handler.postStar({ domainId: "system", star: value }));
        expect(post).toHaveBeenCalledOnce();
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
