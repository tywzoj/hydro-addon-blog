import type { Context } from "hydrooj";
import { OplogModel, param, requireSudo, Types, UserModel, ValidationError } from "hydrooj";

import { SYSTEM_DOMAIN } from "./constants";
import { BlogBaseHandler } from "./handler.base";
import { BLOG_PERMISSIONS } from "./permission";
import type { BlogRole } from "./settings.model";
import { BlogSettingsModel } from "./settings.model";

export function parsePermissions(input: unknown, roles: BlogRole[]) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("permissions");
    const changes: [string, bigint][] = [];
    for (const [id, raw] of Object.entries(input)) {
        const role = roles.find((r) => r.id === id);
        if (!role) throw new ValidationError("role");
        if (role.name === "root") continue;
        let mask = 0n;
        const values: unknown[] = Array.isArray(raw) ? raw : [raw];
        for (const value of values) {
            if (value === "1000") continue;
            if (typeof value !== "string" || !/^\d+$/.test(value)) throw new ValidationError("permissions");
            const permission = BLOG_PERMISSIONS.find((p) => p.index === Number(value));
            if (!permission) throw new ValidationError("permissions");
            mask |= permission.bit;
        }
        changes.push([role.name, mask]);
    }
    return Object.fromEntries(changes);
}

class BlogSettingsHandler extends BlogBaseHandler {
    prepare() {
        this.blog.requireLogin();
        this.blog.require("MANAGE_SETTINGS");
    }

    get(_?: unknown, _page?: number): void | Promise<void> {
        this.response.template = "blog_settings.html";
        this.response.body = { blog_role: this.blog.role };
    }
}

class BlogRoleHandler extends BlogSettingsHandler {
    @requireSudo
    async get() {
        this.response.template = "blog_settings_roles.html";
        this.response.body = { settings: await BlogSettingsModel.get() };
    }

    @param("role", Types.Role)
    @param("revision", Types.UnsignedInt)
    async postAdd(_, role: string, revision: number) {
        const result = await BlogSettingsModel.addRole(role, revision);
        await OplogModel.log(this, "blog.role.create", result);
        this.back();
    }

    @requireSudo
    @param("role", Types.Role)
    @param("revision", Types.UnsignedInt)
    async postDelete(_, role: string, revision: number) {
        const result = await BlogSettingsModel.deleteRole(role, revision);
        await OplogModel.log(this, "blog.role.delete", result);
        this.back();
    }
}

class BlogPermissionHandler extends BlogSettingsHandler {
    @requireSudo
    async get() {
        const settings = await BlogSettingsModel.get();
        this.response.template = "blog_settings_permissions.html";
        this.response.body = {
            settings,
            roles: settings.roles.map((r) => ({ ...r, perm: BigInt(r.permissions) })),
            permissions: BLOG_PERMISSIONS,
        };
    }

    @requireSudo
    @param("revision", Types.UnsignedInt)
    async post(_, revision: number) {
        const previous = await BlogSettingsModel.get();
        const body = this.request.body as Record<string, unknown>;
        const changes = parsePermissions(body.permissions, previous.roles);
        await BlogSettingsModel.permissions(changes, revision);
        await OplogModel.log(this, "blog.permissions", {
            previous: previous.roles,
            permissions: Object.fromEntries(Object.entries(changes).map(([name, mask]) => [name, mask.toString()])),
        });
        this.back();
    }
}

class BlogRoleUserHandler extends BlogSettingsHandler {
    @requireSudo
    @param("page", Types.PositiveInt, true)
    async get(_, page = 1) {
        const [settings, result] = await Promise.all([BlogSettingsModel.get(), BlogSettingsModel.listUsers(page)]);
        this.response.template = "blog_settings_users.html";
        this.response.body = { settings, ...result, page, dpcount: Math.ceil(result.count / 20) };
    }

    @requireSudo
    @param("uid", Types.UidOrName)
    @param("role", Types.Role)
    async postAssign(_, uid: string, role: string) {
        const user = /^\d+$/.test(uid)
            ? await UserModel.getById(SYSTEM_DOMAIN, Number(uid))
            : await UserModel.getByUname(SYSTEM_DOMAIN, uid);
        if (!user) throw new ValidationError("uid");
        const result = await BlogSettingsModel.assign(user._id, role);
        await OplogModel.log(this, "blog.role.assign", result);
        this.back();
    }
}

export function applySettingsHandler(ctx: Context) {
    ctx.Route("blog_settings", "/blog/settings", BlogSettingsHandler);
    ctx.Route("blog_settings_roles", "/blog/settings/roles", BlogRoleHandler);
    ctx.Route("blog_settings_permissions", "/blog/settings/permissions", BlogPermissionHandler);
    ctx.Route("blog_settings_users", "/blog/settings/users", BlogRoleUserHandler);
}
