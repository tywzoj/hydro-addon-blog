import { randomUUID } from "node:crypto";

import type { Context, Handler } from "hydrooj";
import { PRIV, UserModel, ValidationError } from "hydrooj";
import type { Collection } from "mongodb";

import { SYSTEM_DOMAIN } from "./constants";
import type { BlogIdentity } from "./permission";
import { BLOG_ALL, BLOG_DEFAULT, BLOG_KNOWN, BlogPolicy } from "./permission";

export interface BlogRole {
    id: string;
    name: string;
    permissions: string;
}

export interface BlogSettings {
    _id: "global";
    version: 1;
    revision: number;
    roles: BlogRole[];
    deletedRoles: string[];
}

export interface BlogAssignment {
    _id: number;
    role: string;
}

declare module "hydrooj" {
    interface Collections {
        "blog.settings": BlogSettings;
        "blog.user": BlogAssignment;
    }
}

export const BUILTIN_BLOG_ROLES = ["guest", "default", "root"];
const requestPolicies = new WeakMap<Handler, Promise<BlogPolicy>>();

export function initialSettings(): BlogSettings {
    return {
        _id: "global",
        version: 1,
        revision: 0,
        roles: [
            { id: "guest", name: "guest", permissions: "0" },
            { id: "default", name: "default", permissions: BLOG_DEFAULT.toString() },
            { id: "root", name: "root", permissions: BLOG_ALL.toString() },
        ],
        deletedRoles: [],
    };
}

export function resolveBlogPolicy(user: BlogIdentity, settings: BlogSettings, assignment?: BlogAssignment | null) {
    let name = "default";
    if (user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) name = "root";
    else if (user._id <= 0 || !user.hasPriv(PRIV.PRIV_USER_PROFILE)) name = "guest";
    else if (assignment) {
        const role = settings.roles.find((r) => r.id === assignment.role);
        if (role) name = role.name;
        else if (!settings.deletedRoles.includes(assignment.role)) throw new ValidationError("role");
    }
    const role = settings.roles.find((r) => r.name === name);
    if (!role) throw new ValidationError("role");
    return new BlogPolicy(user, name, name === "root" ? BLOG_ALL : BigInt(role.permissions));
}

export class BlogSettingsModel {
    static settings: Collection<BlogSettings>;
    static users: Collection<BlogAssignment>;

    static async init(ctx: Context) {
        this.settings = ctx.db.collection("blog.settings");
        this.users = ctx.db.collection("blog.user");
        await this.settings.updateOne({ _id: "global" }, { $setOnInsert: initialSettings() }, { upsert: true });
        await ctx.db.ensureIndexes(this.users, { key: { role: 1 }, name: "blogUserRole" });
    }

    static async get() {
        const settings = await this.settings.findOne({ _id: "global" });
        if (!settings || settings.version !== 1) throw new ValidationError("blog.settings");
        return settings;
    }

    static async policy(user: BlogIdentity) {
        const [settings, assignment] = await Promise.all([
            this.get(),
            user._id > 0 ? this.users.findOne({ _id: user._id }) : null,
        ]);
        return resolveBlogPolicy(user, settings, assignment);
    }

    static forRequest(handler: Handler) {
        let policy = requestPolicies.get(handler);
        if (!policy) {
            policy = this.policy(handler.user);
            requestPolicies.set(handler, policy);
        }
        return policy;
    }

    static async save(settings: BlogSettings, revision: number) {
        if (settings.revision !== revision) {
            throw new ValidationError("revision", null, "Blog settings changed. Reload and retry.");
        }
        const result = await this.settings.updateOne(
            { _id: "global", revision },
            { $set: { roles: settings.roles, deletedRoles: settings.deletedRoles }, $inc: { revision: 1 } },
        );
        if (!result.matchedCount) {
            throw new ValidationError("revision", null, "Blog settings changed. Reload and retry.");
        }
    }

    static async addRole(name: string, revision: number) {
        const settings = await this.get();
        if (settings.roles.some((r) => r.name === name)) {
            throw new ValidationError("role", null, "Role already exists.");
        }
        const role = {
            id: randomUUID(),
            name,
            permissions: settings.roles.find((r) => r.name === "default")!.permissions,
        };
        settings.roles.push(role);
        await this.save(settings, revision);
        return role;
    }

    static async deleteRole(name: string, revision: number) {
        const settings = await this.get();
        const role = settings.roles.find((r) => r.name === name);
        if (!role || BUILTIN_BLOG_ROLES.includes(name)) throw new ValidationError("role");
        settings.roles = settings.roles.filter((r) => r.id !== role.id);
        // Keep a tombstone: concurrent assignments and recreated names cannot revive deleted grants.
        settings.deletedRoles.push(role.id);
        await this.save(settings, revision);
        return role;
    }

    static async permissions(changes: Record<string, bigint>, revision: number) {
        const settings = await this.get();
        for (const [name, permissions] of Object.entries(changes)) {
            if (name === "root") continue;
            const role = settings.roles.find((r) => r.name === name);
            if (!role || permissions < 0n || (permissions & BLOG_KNOWN) !== permissions) {
                throw new ValidationError("permissions");
            }
            role.permissions = permissions.toString();
        }
        await this.save(settings, revision);
    }

    static async assign(uid: number, name: string) {
        const [settings, user] = await Promise.all([this.get(), UserModel.getById(SYSTEM_DOMAIN, uid)]);
        const role = settings.roles.find((r) => r.name === name);
        if (uid <= 0 || !user?.hasPriv(PRIV.PRIV_USER_PROFILE) || !role) throw new ValidationError("role");
        const previous = await this.users.findOne({ _id: uid });
        if (name === "default") await this.users.deleteOne({ _id: uid });
        else await this.users.updateOne({ _id: uid }, { $set: { role: role.id } }, { upsert: true });
        return { uid, previous: previous?.role ?? "default", role: role.id };
    }

    static async listUsers(page: number) {
        const settings = await this.get();
        const visibleRoles = settings.roles.filter((r) => !["guest", "default"].includes(r.name));
        const rows = await UserModel.coll
            .aggregate<{ entries: { _id: number; blogAssignment?: BlogAssignment }[]; count: { total: number }[] }>([
                { $match: { _id: { $gt: 0 }, priv: { $bitsAllSet: PRIV.PRIV_USER_PROFILE } } },
                { $lookup: { from: "blog.user", localField: "_id", foreignField: "_id", as: "blogAssignment" } },
                { $unwind: { path: "$blogAssignment", preserveNullAndEmptyArrays: true } },
                {
                    $match: {
                        $or: [
                            { priv: { $bitsAllSet: PRIV.PRIV_EDIT_SYSTEM } },
                            { "blogAssignment.role": { $in: visibleRoles.map((r) => r.id) } },
                        ],
                    },
                },
                { $sort: { _id: 1 } },
                {
                    $facet: {
                        entries: [
                            { $skip: (page - 1) * 20 },
                            { $limit: 20 },
                            { $project: { _id: 1, blogAssignment: 1 } },
                        ],
                        count: [{ $count: "total" }],
                    },
                },
            ])
            .toArray();
        const entries = rows[0]?.entries ?? [];
        const users = await UserModel.getList(
            SYSTEM_DOMAIN,
            entries.map((r) => r._id),
        );
        return {
            entries: entries.map((entry) => ({
                user: users[entry._id],
                role: resolveBlogPolicy(users[entry._id], settings, entry.blogAssignment).role,
                forced: users[entry._id].hasPriv(PRIV.PRIV_EDIT_SYSTEM),
            })),
            count: rows[0]?.count[0]?.total ?? 0,
        };
    }
}
