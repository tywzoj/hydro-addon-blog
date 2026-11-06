import type { Context } from "hydrooj";
import { OplogModel, param, requireSudo, Types, UserModel, ValidationError } from "hydrooj";

import {
    BLOG_FIRST_PAGE,
    BLOG_NONE,
    BLOG_PERMISSION_PLACEHOLDER,
    BLOG_USERS_PER_PAGE,
    BlogAuditEvents,
    BlogPermissions,
    BlogRoles,
    ROUTE_BLOG_SETTINGS,
    ROUTE_BLOG_SETTINGS_PERMISSIONS,
    ROUTE_BLOG_SETTINGS_ROLES,
    ROUTE_BLOG_SETTINGS_USERS,
    SYSTEM_DOMAIN,
    TEMPLATE_BLOG_SETTINGS,
    TEMPLATE_BLOG_SETTINGS_PERMISSIONS,
    TEMPLATE_BLOG_SETTINGS_ROLES,
    TEMPLATE_BLOG_SETTINGS_USERS,
} from "./constants";
import { BlogBaseHandler } from "./handler.base";
import { BLOG_PERMISSIONS } from "./permission";
import { BlogSettingsModel, permissionMatrixRoles } from "./settings.model";
import type { BlogRole } from "./types";
import { toTemplate } from "./utils";

export function parsePermissions(input: unknown, roles: BlogRole[]) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("permissions");
    const changes: [string, bigint][] = [];
    for (const [id, raw] of Object.entries(input)) {
        const role = roles.find((r) => r.id === id);
        if (!role) throw new ValidationError("role");
        if (role.name === BlogRoles.Root) continue;
        let mask = BLOG_NONE;
        const values: unknown[] = Array.isArray(raw) ? raw : [raw];
        for (const value of values) {
            if (value === BLOG_PERMISSION_PLACEHOLDER) continue;
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
    url(name: string, ...args: Record<string, unknown>[]) {
        return super.url(name, ...args, ...(name === "user_sudo" ? [{ domainId: SYSTEM_DOMAIN }] : []));
    }

    prepare() {
        this.blog.requireLogin();
        this.blog.require(BlogPermissions.MANAGE_SETTINGS);
    }

    get(_?: unknown, _page?: number): void | Promise<void> {
        this.response.template = toTemplate(TEMPLATE_BLOG_SETTINGS);
        this.response.body = { blog_role: this.blog.role };
    }
}

class BlogRoleHandler extends BlogSettingsHandler {
    @requireSudo
    async get() {
        this.response.template = toTemplate(TEMPLATE_BLOG_SETTINGS_ROLES);
        this.response.body = { settings: await BlogSettingsModel.get() };
    }

    @param("role", Types.Role)
    @param("revision", Types.UnsignedInt)
    async postAdd(_, role: string, revision: number) {
        const result = await BlogSettingsModel.addRole(role, revision);
        await OplogModel.log(this, BlogAuditEvents.CreateRole, result);
        this.back();
    }

    @requireSudo
    @param("role", Types.Role)
    @param("revision", Types.UnsignedInt)
    async postDelete(_, role: string, revision: number) {
        const result = await BlogSettingsModel.deleteRole(role, revision);
        await OplogModel.log(this, BlogAuditEvents.DeleteRole, result);
        this.back();
    }

    @requireSudo
    @param("roles", Types.CommaSeperatedArray)
    @param("revision", Types.UnsignedInt)
    async postDeleteRoles(_, roles: string[], revision: number) {
        const result = await BlogSettingsModel.deleteRoles(roles, revision);
        await OplogModel.log(this, BlogAuditEvents.DeleteRole, { roles: result });
        this.back();
    }
}

class BlogPermissionHandler extends BlogSettingsHandler {
    @requireSudo
    async get() {
        const settings = await BlogSettingsModel.get();
        this.response.template = toTemplate(TEMPLATE_BLOG_SETTINGS_PERMISSIONS);
        this.response.body = {
            settings,
            roles: permissionMatrixRoles(settings).map((r) => ({ ...r, perm: BigInt(r.permissions) })),
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
        await OplogModel.log(this, BlogAuditEvents.Permissions, {
            previous: previous.roles,
            permissions: Object.fromEntries(Object.entries(changes).map(([name, mask]) => [name, mask.toString()])),
        });
        this.back();
    }
}

class BlogRoleUserHandler extends BlogSettingsHandler {
    @requireSudo
    @param("page", Types.PositiveInt, true)
    async get(_, page = BLOG_FIRST_PAGE) {
        const [settings, result] = await Promise.all([BlogSettingsModel.get(), BlogSettingsModel.listUsers(page)]);
        this.response.template = toTemplate(TEMPLATE_BLOG_SETTINGS_USERS);
        this.response.body = { settings, ...result, page, dpcount: Math.ceil(result.count / BLOG_USERS_PER_PAGE) };
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
        await OplogModel.log(this, BlogAuditEvents.AssignRole, result);
        this.back();
    }

    @requireSudo
    @param("uids", Types.NumericArray)
    @param("role", Types.Role)
    async postSetUsers(_, uids: number[], role: string) {
        const users = await BlogSettingsModel.assignMany(uids, role);
        await OplogModel.log(this, BlogAuditEvents.AssignRole, { users });
        this.back();
    }
}

export function applySettingsHandler(ctx: Context) {
    ctx.Route(ROUTE_BLOG_SETTINGS, "/blog/settings", BlogSettingsHandler);
    ctx.Route(ROUTE_BLOG_SETTINGS_ROLES, "/blog/settings/roles", BlogRoleHandler);
    ctx.Route(ROUTE_BLOG_SETTINGS_PERMISSIONS, "/blog/settings/permissions", BlogPermissionHandler);
    ctx.Route(ROUTE_BLOG_SETTINGS_USERS, "/blog/settings/users", BlogRoleUserHandler);
}
