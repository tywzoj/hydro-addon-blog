import type { Context } from "hydrooj";
import type { Collection } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BLOG_DEFAULT, BLOG_PERM } from "../../features/permission";
import { applySettingsHandler, parsePermissions } from "../../features/settings.handler";
import type { BlogAssignment, BlogSettings } from "../../features/settings.model";
import { BlogSettingsModel, initialSettings, resolveBlogPolicy } from "../../features/settings.model";
import type { Handler } from "../helpers/hydro";
import { makeUser, OplogModel, PRIV, UserModel, ValidationError } from "../helpers/hydro";

let settings: BlogSettings;
const findOne = vi.fn();
const updateOne = vi.fn();
const assignments = { findOne: vi.fn(), updateOne: vi.fn(), deleteOne: vi.fn() };

beforeEach(() => {
    vi.resetAllMocks();
    settings = initialSettings();
    findOne.mockImplementation(() => Promise.resolve(structuredClone(settings)));
    updateOne.mockResolvedValue({ matchedCount: 1 });
    BlogSettingsModel.settings = { findOne, updateOne } as unknown as Collection<BlogSettings>;
    BlogSettingsModel.users = assignments as unknown as Collection<BlogAssignment>;
    UserModel.getById.mockResolvedValue(makeUser(2));
});

describe("blog settings persistence", () => {
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
            { $set: { roles: initialSettings().roles, deletedRoles: ["old"] }, $inc: { revision: 1 } },
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

    it.each([null, [], { missing: "0" }, { default: "999" }, { default: "-1" }, { default: {} }])(
        "rejects malformed or unknown permission submissions %j",
        (input) => expect(() => parsePermissions(input, settings.roles)).toThrow(ValidationError),
    );

    it("rejects unknown masks and roles before persistence", async () => {
        for (const changes of [{ default: -1n }, { default: 1n << 30n }, { missing: 1n }]) {
            await expect(BlogSettingsModel.permissions(changes, 0)).rejects.toBeInstanceOf(ValidationError);
        }
        expect(updateOne).not.toHaveBeenCalled();
    });

    it("supports manual root and default reset without modifying Hydro users", async () => {
        await BlogSettingsModel.assign(2, "root");
        expect(assignments.updateOne).toHaveBeenCalledWith({ _id: 2 }, { $set: { role: "root" } }, { upsert: true });
        await BlogSettingsModel.assign(2, "default");
        expect(assignments.deleteOne).toHaveBeenCalledWith({ _id: 2 });
        await expect(BlogSettingsModel.assign(0, "root")).rejects.toBeInstanceOf(ValidationError);
        await expect(BlogSettingsModel.assign(2, "missing")).rejects.toBeInstanceOf(ValidationError);
    });

    it("filters default and guest before pagination and includes forced-root users", async () => {
        settings.roles.push({ id: "custom-id", name: "custom", permissions: "1" });
        UserModel.coll.aggregate.mockReturnValue({ toArray: () => Promise.resolve([{ entries: [], count: [] }]) });
        UserModel.getList.mockResolvedValue({});
        expect(await BlogSettingsModel.listUsers(2)).toEqual({ entries: [], count: 0 });
        const pipeline = UserModel.coll.aggregate.mock.calls[0][0] as Record<string, unknown>[];
        expect(pipeline[3]).toEqual({
            $match: {
                $or: [
                    { priv: { $bitsAllSet: PRIV.PRIV_EDIT_SYSTEM } },
                    { "blogAssignment.role": { $in: ["root", "custom-id"] } },
                ],
            },
        });
        expect(pipeline[5]).toMatchObject({ $facet: { entries: [{ $skip: 20 }, { $limit: 20 }, expect.anything()] } });
    });
});

interface SettingsHandler extends Handler {
    blog: ReturnType<typeof resolveBlogPolicy>;
    prepare: () => void;
    get: (args?: Record<string, unknown>) => unknown;
    postAdd: (args: Record<string, unknown>) => Promise<void>;
    postDelete: (args: Record<string, unknown>) => unknown;
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
});
