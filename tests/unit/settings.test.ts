import type { Context } from "hydrooj";
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
import type { Handler } from "../helpers/hydro";
import {
    dispatchHandler,
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
        vi.spyOn(BlogReviewModel, "approvePending").mockImplementation(async (_uid, notify) => {
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
