import type { Context, Handler as HydroHandler } from "hydrooj";
import type { Collection } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BLOG_DEFAULT, BLOG_PERM } from "../../features/permission";
import { BlogReviewModel } from "../../features/review.model";
import { applySettingsHandler, parsePermissions } from "../../features/settings.handler";
import type { BlogAssignment, BlogSettings } from "../../features/settings.model";
import {
    BlogSettingsModel,
    initialSettings,
    permissionMatrixRoles,
    resolveBlogPolicy,
} from "../../features/settings.model";
import { makeBlog } from "../helpers/fixtures";
import {
    dispatchHandler,
    Handler,
    makeUser,
    MessageModel,
    OplogModel,
    PRIV,
    UserModel,
    ValidationError,
} from "../helpers/hydro";

let settings: BlogSettings;
const findOne = vi.fn();
const updateOne = vi.fn();
const assignments = { findOne: vi.fn(), find: vi.fn(), bulkWrite: vi.fn(), aggregate: vi.fn() };

beforeEach(() => {
    vi.resetAllMocks();
    settings = initialSettings();
    findOne.mockImplementation(() => Promise.resolve(structuredClone(settings)));
    updateOne.mockResolvedValue({ matchedCount: 1 });
    BlogSettingsModel.settings = { findOne, updateOne } as unknown as Collection<BlogSettings>;
    BlogSettingsModel.users = assignments as unknown as Collection<BlogAssignment>;
    UserModel.getById.mockResolvedValue(makeUser(2));
    UserModel.getList.mockResolvedValue({ 2: makeUser(2), 3: makeUser(3) });
    assignments.find.mockReturnValue({ toArray: () => Promise.resolve([]) });
});

describe("blog settings persistence", () => {
    it("initializes settings without overwriting existing roles and indexes role assignments", async () => {
        const collection = vi.fn().mockReturnValueOnce({ findOne, updateOne }).mockReturnValueOnce(assignments);
        const ensureIndexes = vi.fn();
        await BlogSettingsModel.init({ db: { collection, ensureIndexes } } as unknown as Context);
        expect(updateOne).toHaveBeenCalledWith(
            { _id: "global" },
            { $setOnInsert: initialSettings() },
            { upsert: true },
        );
        expect(ensureIndexes).toHaveBeenCalledWith(assignments, { key: { role: 1 }, name: "blogUserRole" });
    });

    it.each([null, { ...initialSettings(), version: -1 }])(
        "rejects missing or unsupported settings %j",
        async (stored) => {
            findOne.mockResolvedValue(stored);
            await expect(BlogSettingsModel.get()).rejects.toBeInstanceOf(ValidationError);
            expect(updateOne).not.toHaveBeenCalled();
        },
    );

    it("caches policy only within one request and skips anonymous assignments", async () => {
        assignments.findOne.mockResolvedValue({ _id: 2, role: "root" });
        const request = new Handler();
        request.user = makeUser(2);
        const first = BlogSettingsModel.forRequest(request as unknown as HydroHandler);
        const second = BlogSettingsModel.forRequest(request as unknown as HydroHandler);
        expect(first).toBe(second);
        expect((await first).role).toBe("root");
        expect(findOne).toHaveBeenCalledOnce();
        expect(assignments.findOne).toHaveBeenCalledExactlyOnceWith({ _id: 2 });
        assignments.findOne.mockResolvedValue(null);
        expect((await BlogSettingsModel.policy(makeUser(2))).role).toBe("default");
        expect((await BlogSettingsModel.policy(makeUser(0, 0))).role).toBe("guest");
        expect(assignments.findOne).toHaveBeenCalledTimes(2);
    });

    it("rejects missing effective roles instead of granting fallback permissions", () => {
        settings.roles = settings.roles.filter((role) => role.name !== "default");
        expect(() => resolveBlogPolicy(makeUser(2), settings)).toThrow(ValidationError);
    });

    it("reports concurrent settings updates for review and permission saves", async () => {
        updateOne.mockResolvedValue({ matchedCount: 0 });
        await expect(BlogSettingsModel.setReview(settings.review!, 0)).rejects.toBeInstanceOf(ValidationError);
        await expect(BlogSettingsModel.permissions({ default: 0n }, 0)).rejects.toBeInstanceOf(ValidationError);
        expect(updateOne).toHaveBeenCalledTimes(2);
    });

    it.each([{ names: [] }, { names: ["missing"] }])(
        "rejects empty or unknown role deletion $names before persistence",
        async ({ names }) => {
            await expect(BlogSettingsModel.deleteRoles(names, 0)).rejects.toBeInstanceOf(ValidationError);
            expect(updateOne).not.toHaveBeenCalled();
        },
    );

    it("returns an empty user page when aggregation has no rows", async () => {
        assignments.aggregate.mockReturnValue({ toArray: () => Promise.resolve([]) });
        expect(await BlogSettingsModel.listUsers(1)).toEqual({ entries: [], count: 0 });
        expect(UserModel.getList).toHaveBeenCalledWith("system", []);
    });

    it("records previous role identities when resetting assignments", async () => {
        assignments.find.mockReturnValue({
            toArray: () => Promise.resolve([{ _id: 2, role: "retired-role" }]),
        });
        expect(await BlogSettingsModel.assignMany([2, 3], "default")).toEqual([
            { uid: 2, previous: "retired-role", role: "default" },
            { uid: 3, previous: "default", role: "default" },
        ]);
        expect(assignments.bulkWrite).toHaveBeenCalledWith([
            { deleteOne: { filter: { _id: 2 } } },
            { deleteOne: { filter: { _id: 3 } } },
        ]);
    });

    it("saves moderation independently of roles and changes reminder revision only for cadence changes", async () => {
        const input = {
            mode: "before" as const,
            reportLimit: 0,
            rejectionLimit: 3,
            reminders: true,
            intervalMinutes: 1440,
        };
        await BlogSettingsModel.setReview(input, 0);
        expect(updateOne).toHaveBeenLastCalledWith(
            { _id: "global", revision: 0 },
            {
                $set: {
                    "review.mode": "before",
                    "review.reportLimit": 0,
                    "review.rejectionLimit": 3,
                    "review.reminders": true,
                    "review.intervalMinutes": 1440,
                    "review.reminderRevision": 0,
                },
                $inc: { revision: 1 },
            },
        );
        await BlogSettingsModel.setReview({ ...input, reminders: false }, 0);
        expect(updateOne).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                $set: expect.objectContaining({ "review.reminderRevision": 1 }) as unknown,
                $currentDate: { "review.reminderChangedAt": true },
            }),
        );
    });

    it("supplies compatible review defaults without mutating legacy settings", async () => {
        delete settings.review;
        expect(await BlogSettingsModel.review()).toMatchObject({
            mode: "disabled",
            reminders: true,
            intervalMinutes: 1440,
        });
        expect(updateOne).not.toHaveBeenCalled();
    });

    it("rejects malformed or stale review configuration before persistence", async () => {
        const input = {
            mode: "after" as const,
            reportLimit: 3,
            rejectionLimit: 3,
            reminders: true,
            intervalMinutes: 1440,
        };
        for (const changes of [
            { reportLimit: -1 },
            { rejectionLimit: 0 },
            { intervalMinutes: 0 },
            { intervalMinutes: Number.MAX_SAFE_INTEGER },
        ]) {
            await expect(BlogSettingsModel.setReview({ ...input, ...changes }, 0)).rejects.toThrow();
        }
        await expect(BlogSettingsModel.setReview(input, 9)).rejects.toThrow();
        expect(updateOne).not.toHaveBeenCalled();
    });
    it("creates roles from the current default and rejects duplicates with a zero mask", async () => {
        settings.roles[1].permissions = "0";
        const role = await BlogSettingsModel.addRole("审稿人", 0);
        expect(role.permissions).toBe("0");
        settings.roles.push(role);
        await expect(BlogSettingsModel.addRole("审稿人", 0)).rejects.toBeInstanceOf(ValidationError);
    });

    it("protects built-ins and records deleted role identities", async () => {
        for (const role of ["root", "default", "guest"]) {
            await expect(BlogSettingsModel.deleteRole(role, 0)).rejects.toBeInstanceOf(ValidationError);
        }
        settings.roles.push({ id: "old", name: "reviewer", permissions: "1" });
        await BlogSettingsModel.deleteRole("reviewer", 0);
        expect(updateOne).toHaveBeenCalledWith(
            { _id: "global", revision: 0 },
            {
                $set: { roles: initialSettings().roles, deletedRoles: ["old"], permissionRoleOrder: [] },
                $inc: { revision: 1 },
            },
        );
    });

    it("rejects stale configuration revisions", async () => {
        updateOne.mockResolvedValue({ matchedCount: 0 });
        await expect(BlogSettingsModel.permissions({ default: 0n }, 5)).rejects.toBeInstanceOf(ValidationError);
    });

    it("saves an unchecked role as zero and ignores submitted root edits", async () => {
        const changes = parsePermissions(
            { default: "1000", guest: ["1000", "0", "1"], root: "invalid" },
            settings.roles,
        );
        expect(changes).toEqual({ default: 0n, guest: BLOG_PERM.ACCESS | BLOG_PERM.VIEW_PUBLISHED });
        await BlogSettingsModel.permissions({ ...changes, root: 0n }, 0);
        expect(updateOne).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                $set: expect.objectContaining({
                    roles: expect.arrayContaining([
                        expect.objectContaining({ name: "default", permissions: "0" }),
                        expect.objectContaining({ name: "root", permissions: "-1" }),
                    ]) as unknown,
                }) as unknown,
            }),
        );
    });

    it.each([null, [], { missing: "0" }, { default: "23" }, { default: "999" }, { default: "-1" }, { default: {} }])(
        "rejects malformed or unknown permission submissions %j",
        (input) => expect(() => parsePermissions(input, settings.roles)).toThrow(ValidationError),
    );

    it("rejects unknown masks and roles before persistence", async () => {
        const invalidChanges: Record<string, bigint>[] = [{ default: -1n }, { default: 1n << 30n }, { missing: 1n }];
        for (const changes of invalidChanges) {
            await expect(BlogSettingsModel.permissions(changes, 0)).rejects.toBeInstanceOf(ValidationError);
        }
        expect(updateOne).not.toHaveBeenCalled();
    });

    it("supports manual root and default reset without modifying Hydro users", async () => {
        await BlogSettingsModel.assign(2, "root");
        expect(assignments.bulkWrite).toHaveBeenCalledWith([
            { updateOne: { filter: { _id: 2 }, update: { $set: { role: "root" } }, upsert: true } },
        ]);
        await BlogSettingsModel.assign(2, "default");
        expect(assignments.bulkWrite).toHaveBeenCalledWith([{ deleteOne: { filter: { _id: 2 } } }]);
        await expect(BlogSettingsModel.assign(0, "root")).rejects.toBeInstanceOf(ValidationError);
        await expect(BlogSettingsModel.assign(2, "missing")).rejects.toBeInstanceOf(ValidationError);
    });

    it("validates every selected user before any bulk write and deduplicates valid selections", async () => {
        await expect(BlogSettingsModel.assignMany([2, 999], "root")).rejects.toBeInstanceOf(ValidationError);
        await expect(BlogSettingsModel.assignMany([], "root")).rejects.toBeInstanceOf(ValidationError);
        await expect(BlogSettingsModel.assignMany([0], "root")).rejects.toBeInstanceOf(ValidationError);
        expect(assignments.bulkWrite).not.toHaveBeenCalled();
        await BlogSettingsModel.assignMany([2, 3, 2], "root");
        expect(assignments.bulkWrite).toHaveBeenCalledExactlyOnceWith([
            { updateOne: { filter: { _id: 2 }, update: { $set: { role: "root" } }, upsert: true } },
            { updateOne: { filter: { _id: 3 }, update: { $set: { role: "root" } }, upsert: true } },
        ]);
    });

    it("rejects assigning guest through single and bulk operations before writing", async () => {
        await expect(BlogSettingsModel.assign(2, "guest")).rejects.toBeInstanceOf(ValidationError);
        await expect(BlogSettingsModel.assignMany([2, 3], "guest")).rejects.toBeInstanceOf(ValidationError);
        expect(assignments.bulkWrite).not.toHaveBeenCalled();
    });

    it("rejects a mixed built-in/custom role deletion before modifying settings", async () => {
        settings.roles.push({ id: "custom-id", name: "custom", permissions: "1" });
        await expect(BlogSettingsModel.deleteRoles(["custom", "default"], 0)).rejects.toBeInstanceOf(ValidationError);
        expect(updateOne).not.toHaveBeenCalled();
        const result = await BlogSettingsModel.deleteRoles(["custom", "custom"], 0);
        expect(result).toHaveLength(1);
    });

    it("filters default and guest before pagination and includes forced-root users", async () => {
        settings.roles.push({ id: "custom-id", name: "custom", permissions: "1" });
        assignments.aggregate.mockReturnValue({ toArray: () => Promise.resolve([{ entries: [], count: [] }]) });
        UserModel.getList.mockResolvedValue({});
        expect(await BlogSettingsModel.listUsers(2)).toEqual({ entries: [], count: 0 });
        const pipeline = assignments.aggregate.mock.calls[0][0] as Record<string, unknown>[];
        expect(pipeline[0]).toEqual({ $match: { role: { $in: ["root", "custom-id"] } } });
        expect(pipeline[1]).toEqual({
            $lookup: { from: "user", localField: "_id", foreignField: "_id", as: "user" },
        });
        expect(pipeline[3]).toEqual({
            $match: {
                "user._id": { $gt: 0 },
                "user.priv": { $bitsAllSet: PRIV.PRIV_USER_PROFILE },
            },
        });
        expect(pipeline[5]).toEqual({
            $unionWith: {
                coll: "user",
                pipeline: [
                    {
                        $match: {
                            _id: { $gt: 0 },
                            priv: { $bitsAllSet: PRIV.PRIV_USER_PROFILE | PRIV.PRIV_EDIT_SYSTEM },
                        },
                    },
                    { $project: { _id: 1 } },
                ],
            },
        });
        expect(pipeline[6]).toEqual({ $group: { _id: "$_id", blogAssignment: { $first: "$blogAssignment" } } });
        expect(pipeline[8]).toMatchObject({ $facet: { entries: [{ $skip: 20 }, { $limit: 20 }, expect.anything()] } });
        expect(UserModel.coll.aggregate).not.toHaveBeenCalled();
    });

    it("loads profiles only for the paginated results and preserves forced root", async () => {
        settings.roles.push({ id: "custom-id", name: "reviewer", permissions: "1" });
        assignments.aggregate.mockReturnValue({
            toArray: () =>
                Promise.resolve([
                    {
                        entries: [{ _id: 2, blogAssignment: { _id: 2, role: "custom-id" } }, { _id: 4 }],
                        count: [{ total: 25 }],
                    },
                ]),
        });
        UserModel.getList.mockResolvedValue({
            2: makeUser(2),
            4: makeUser(4, PRIV.PRIV_USER_PROFILE | PRIV.PRIV_EDIT_SYSTEM),
        });
        const result = await BlogSettingsModel.listUsers(2);
        expect(UserModel.getList).toHaveBeenCalledExactlyOnceWith("system", [2, 4]);
        expect(result.count).toBe(25);
        expect(result.entries.map(({ user, role, forced }) => ({ uid: user._id, role, forced }))).toEqual([
            { uid: 2, role: "reviewer", forced: false },
            { uid: 4, role: "root", forced: true },
        ]);
    });
});

describe("permission matrix role ordering", () => {
    it("ignores stale ordered identities and tolerates missing built-ins without inventing grants", () => {
        settings.permissionRoleOrder = ["removed", "root", "custom"];
        settings.roles = [
            { id: "custom", name: "custom", permissions: "0" },
            { id: "root", name: "root", permissions: "-1" },
        ];
        expect(permissionMatrixRoles(settings)).toEqual([settings.roles[0], settings.roles[1]]);
    });

    it("uses Hydro dictionary enumeration and builtin fallback for legacy settings without changing masks", () => {
        delete settings.permissionRoleOrder;
        for (const name of ["zeta", "10", "2", "alpha"]) {
            settings.roles.push({ id: `role-${name}`, name, permissions: "1" });
        }
        const before = structuredClone(settings);
        expect(permissionMatrixRoles(settings).map((role) => role.name)).toEqual([
            "2",
            "10",
            "zeta",
            "alpha",
            "guest",
            "default",
            "root",
        ]);
        expect(settings).toEqual(before);
    });

    it("preserves configured-role order across creation, matrix saves and deletion", async () => {
        updateOne.mockImplementation(
            (
                _filter: unknown,
                update: {
                    $set: Pick<BlogSettings, "roles" | "deletedRoles" | "permissionRoleOrder">;
                },
            ) => {
                settings = { ...settings, ...update.$set, revision: settings.revision + 1 };
                return Promise.resolve({ matchedCount: 1 });
            },
        );
        await BlogSettingsModel.addRole("zeta", 0);
        expect(permissionMatrixRoles(await BlogSettingsModel.get()).map((role) => role.name)).toEqual([
            "zeta",
            "guest",
            "default",
            "root",
        ]);
        await BlogSettingsModel.permissions({ zeta: 1n, guest: 0n, default: BLOG_DEFAULT }, 1);
        await BlogSettingsModel.addRole("alpha", 2);
        expect(permissionMatrixRoles(await BlogSettingsModel.get()).map((role) => role.name)).toEqual([
            "zeta",
            "guest",
            "default",
            "alpha",
            "root",
        ]);
        await BlogSettingsModel.deleteRole("zeta", 3);
        expect(permissionMatrixRoles(await BlogSettingsModel.get()).map((role) => role.name)).toEqual([
            "guest",
            "default",
            "alpha",
            "root",
        ]);
    });
});

interface SettingsHandler extends Handler {
    blog: ReturnType<typeof resolveBlogPolicy>;
    prepare: () => void;
    get: (args?: Record<string, unknown>) => unknown;
    postAdd: (args: Record<string, unknown>) => Promise<void>;
    postDelete: (args: Record<string, unknown>) => unknown;
    postDeleteRoles: (args: Record<string, unknown>) => Promise<void>;
    post: (args?: Record<string, unknown>) => Promise<void>;
    postAssign: (args: Record<string, unknown>) => Promise<void>;
    postSetUsers: (args: Record<string, unknown>) => Promise<void>;
    postReviewSettings: (args: Record<string, unknown>) => Promise<void>;
}

describe("settings handler boundaries", () => {
    const routes = new Map<string, new () => SettingsHandler>();
    applySettingsHandler({
        Route: (name: string, _path: string, Class: new () => SettingsHandler) => routes.set(name, Class),
    } as unknown as Context);

    function handler(name: string, mask = BLOG_DEFAULT | BLOG_PERM.MANAGE_SETTINGS) {
        const h = new (routes.get(name)!)();
        h.blog = resolveBlogPolicy(h.user, {
            ...initialSettings(),
            roles: initialSettings().roles.map((r) =>
                r.name === "default" ? { ...r, permissions: mask.toString() } : r,
            ),
        });
        return h;
    }

    const disabled = {
        domainId: "system",
        revision: "0",
        mode: "disabled",
        reportLimit: "3",
        rejectionLimit: "3",
        reminders: "true",
        intervalMinutes: "1440",
    };

    it("uses the system domain only for sudo links", () => {
        const baseUrl = vi.spyOn(Handler.prototype, "url");
        const h = handler("blog_settings");
        h.url("user_sudo", { domainId: "restricted", return: "/blog/settings" });
        expect(baseUrl).toHaveBeenLastCalledWith(
            "user_sudo",
            { domainId: "restricted", return: "/blog/settings" },
            { domainId: "system" },
        );
        h.url("blog_settings", { domainId: "restricted" });
        expect(baseUrl).toHaveBeenLastCalledWith("blog_settings", { domainId: "restricted" });
    });

    it.each(["blog_settings", "blog_settings_roles", "blog_settings_permissions", "blog_settings_users"])(
        "renders authorized %s with its settings and page-specific data",
        async (name) => {
            assignments.aggregate.mockReturnValue({
                toArray: () => Promise.resolve([{ entries: [], count: [{ total: 21 }] }]),
            });
            const h = handler(name);
            await dispatchHandler({ prepare: () => h.prepare() }, "get", () => h.get({ domainId: "system" }));
            expect(h.response.template).toBe(`${name}.html`);
            expect(h.response.body?.settings).toEqual(settings);
            if (name === "blog_settings") {
                expect(h.response.body).toMatchObject({ blog_role: "default", review: settings.review });
            } else if (name === "blog_settings_permissions") {
                expect(h.response.body?.roles).toEqual(
                    permissionMatrixRoles(settings).map((role) => ({ ...role, perm: BigInt(role.permissions) })),
                );
            } else if (name === "blog_settings_users") {
                expect(h.response.body).toMatchObject({ entries: [], count: 21, page: 1, dpcount: 2 });
            }
        },
    );

    it("saves enabled review settings without sweeping pending articles", async () => {
        const approve = vi.spyOn(BlogReviewModel, "approvePending");
        const h = handler("blog_settings");
        await dispatchHandler({ prepare: () => h.prepare() }, "post", () =>
            h.postReviewSettings({
                ...disabled,
                mode: "after",
                reminders: undefined,
            }),
        );
        expect(updateOne).toHaveBeenCalledWith(
            { _id: "global", revision: 0 },
            expect.objectContaining({
                $set: expect.objectContaining({ "review.mode": "after", "review.reminders": false }) as unknown,
            }),
        );
        expect(approve).not.toHaveBeenCalled();
        expect(h.back).toHaveBeenCalledWith({ approved: 0 });
    });

    it.each(["postDelete", "postDeleteRoles"] as const)("audits successful %s after persistence", async (operation) => {
        const role = { id: "custom", name: "reviewer", permissions: "1" };
        settings.roles.push(role);
        const h = handler("blog_settings_roles");
        await dispatchHandler({ prepare: () => h.prepare() }, "post", () =>
            h[operation]({
                domainId: "system",
                role: "reviewer",
                roles: "reviewer",
                revision: "0",
            }),
        );
        expect(OplogModel.log).toHaveBeenCalledWith(
            h,
            "blog.role.delete",
            operation === "postDelete" ? role : { roles: [role] },
        );
        expect(updateOne.mock.invocationCallOrder[0]).toBeLessThan(OplogModel.log.mock.invocationCallOrder[0]);
        expect(h.back).toHaveBeenCalledOnce();
    });

    it("saves a parsed permission matrix with serializable before/after audit data", async () => {
        const h = handler("blog_settings_permissions");
        h.request.body.permissions = { default: ["1000", "0"], guest: "1000" };
        await dispatchHandler({ prepare: () => h.prepare() }, "post", () =>
            h.post({ domainId: "system", revision: "0" }),
        );
        expect(updateOne).toHaveBeenCalledOnce();
        expect(OplogModel.log).toHaveBeenCalledWith(h, "blog.permissions", {
            previous: settings.roles,
            permissions: { default: "1", guest: "0" },
        });
        expect(h.back).toHaveBeenCalledOnce();
    });

    it.each(["2", "user2"])("resolves assignment target %s in the system domain", async (uid) => {
        const h = handler("blog_settings_users");
        UserModel.getByUname.mockResolvedValue(makeUser(2));
        await dispatchHandler({ prepare: () => h.prepare() }, "post", () =>
            h.postAssign({
                domainId: "restricted",
                uid,
                role: "root",
            }),
        );
        if (uid === "2") expect(UserModel.getById).toHaveBeenCalledWith("system", 2);
        else expect(UserModel.getByUname).toHaveBeenCalledWith("system", "user2");
        expect(assignments.bulkWrite).toHaveBeenCalledOnce();
        expect(OplogModel.log).toHaveBeenCalledWith(h, "blog.role.assign", {
            uid: 2,
            previous: "default",
            role: "root",
        });
        expect(h.back).toHaveBeenCalledOnce();
    });

    it("rejects a missing assignment target without writing or auditing", async () => {
        const h = handler("blog_settings_users");
        UserModel.getByUname.mockResolvedValue(null);
        await expect(h.postAssign({ domainId: "system", uid: "missing", role: "root" })).rejects.toBeInstanceOf(
            ValidationError,
        );
        expect(assignments.bulkWrite).not.toHaveBeenCalled();
        expect(OplogModel.log).not.toHaveBeenCalled();
        expect(h.back).not.toHaveBeenCalled();
    });

    it("requires explicit disable confirmation and rejects stale settings before approving articles", async () => {
        const approve = vi.spyOn(BlogReviewModel, "approvePending").mockResolvedValue(0);
        const h = handler("blog_settings");
        await expect(dispatchHandler(h, "post", () => h.postReviewSettings(disabled))).rejects.toBeInstanceOf(
            ValidationError,
        );
        expect(updateOne).not.toHaveBeenCalled();
        await expect(
            dispatchHandler(h, "post", () =>
                h.postReviewSettings({ ...disabled, confirmDisable: "true", revision: "9" }),
            ),
        ).rejects.toBeInstanceOf(ValidationError);
        expect(approve).not.toHaveBeenCalled();
    });

    it("uses settings authority for automatic approval, audit and native author notices", async () => {
        const previous = makeBlog({ reviewPending: true, requiresReview: true });
        const next = makeBlog({ draft: false, reviewPending: false, requiresReview: false });
        vi.spyOn(BlogReviewModel, "approvePending").mockImplementation(async (_uid, _cutoff, notify) => {
            await notify(previous, next);
            return 1;
        });
        const h = handler("blog_settings");
        const prepare = vi.spyOn(h, "prepare");
        expect(h.blog.canReview()).toBe(false);
        await dispatchHandler(h, "post", () => h.postReviewSettings({ ...disabled, confirmDisable: "true" }));
        expect(prepare).toHaveBeenCalledOnce();
        expect(OplogModel.log).toHaveBeenCalledWith(
            h,
            "blog.review",
            expect.objectContaining({
                decision: "approve",
                automatic: true,
                settingsMode: "disabled",
                articleDomainId: "system",
            }),
        );
        expect(MessageModel.send).toHaveBeenCalledOnce();
        expect(h.back).toHaveBeenCalledWith({ approved: 1 });
    });

    it("captures the queue boundary before settings and delayed audit writes", async () => {
        const startedAt = new Date("2026-11-07T10:00:00Z");
        vi.useFakeTimers();
        try {
            vi.setSystemTime(startedAt);
            updateOne.mockImplementation(() => {
                vi.setSystemTime(new Date(startedAt.getTime() + 1000));
                return Promise.resolve({ matchedCount: 1 });
            });
            OplogModel.log.mockImplementationOnce(() => {
                vi.setSystemTime(new Date(startedAt.getTime() + 60_000));
                return Promise.resolve();
            });
            const approve = vi.spyOn(BlogReviewModel, "approvePending").mockResolvedValue(0);
            const h = handler("blog_settings");
            await dispatchHandler(h, "post", () => h.postReviewSettings({ ...disabled, confirmDisable: "true" }));
            expect(approve).toHaveBeenCalledWith(h.user._id, startedAt, expect.any(Function));
        } finally {
            vi.useRealTimers();
        }
    });

    it("surfaces partial batch failure instead of reporting settings success", async () => {
        vi.spyOn(BlogReviewModel, "approvePending").mockRejectedValue(new Error("batch failed"));
        const h = handler("blog_settings");
        await expect(
            dispatchHandler(h, "post", () => h.postReviewSettings({ ...disabled, confirmDisable: "true" })),
        ).rejects.toThrow("batch failed");
        expect(updateOne).toHaveBeenCalledOnce();
        expect(h.back).not.toHaveBeenCalled();
    });

    it("blocks settings actions at preparation before any mutation or automatic approval", async () => {
        const h = handler("blog_settings", BLOG_DEFAULT);
        const approve = vi.spyOn(BlogReviewModel, "approvePending").mockResolvedValue(0);
        await expect(
            dispatchHandler(h, "post", () => h.postReviewSettings({ ...disabled, confirmDisable: "true" })),
        ).rejects.toThrow();
        expect(updateOne).not.toHaveBeenCalled();
        expect(approve).not.toHaveBeenCalled();
        expect(OplogModel.log).not.toHaveBeenCalled();
    });

    it("uses a single management gate for every page", () => {
        for (const name of routes.keys()) {
            expect(() => handler(name).prepare()).not.toThrow();
            expect(() => handler(name, BLOG_DEFAULT).prepare()).toThrow();
        }
    });

    it("matches the role-creation sudo exception while protecting role deletion and GET", async () => {
        const h = handler("blog_settings_roles");
        h.session.sudo = false;
        await h.get();
        expect(h.response.redirect).toBe("/sudo");
        await h.postAdd({ domainId: "system", role: "reviewer", revision: "0" });
        expect(OplogModel.log).toHaveBeenCalledWith(
            h,
            "blog.role.create",
            expect.objectContaining({ name: "reviewer" }),
        );
        updateOne.mockClear();
        await h.postDelete({ domainId: "system", role: "reviewer", revision: "0" });
        expect(updateOne).not.toHaveBeenCalled();
    });

    it("keeps bulk assignment behind sudo and audits only validated writes", async () => {
        const h = handler("blog_settings_users");
        h.session.sudo = false;
        await h.postSetUsers({ domainId: "system", uids: ["2", "3"], role: "root" });
        expect(assignments.bulkWrite).not.toHaveBeenCalled();
        h.session.sudo = true;
        await expect(async () =>
            h.postSetUsers({ domainId: "system", uids: ["2", "invalid"], role: "root" }),
        ).rejects.toBeInstanceOf(ValidationError);
        expect(assignments.bulkWrite).not.toHaveBeenCalled();
        await h.postSetUsers({ domainId: "system", uids: ["2", "3"], role: "root" });
        expect(assignments.bulkWrite).toHaveBeenCalledOnce();
        expect(OplogModel.log).toHaveBeenCalledWith(h, "blog.role.assign", {
            users: [
                { uid: 2, previous: "default", role: "root" },
                { uid: 3, previous: "default", role: "root" },
            ],
        });
    });
});
