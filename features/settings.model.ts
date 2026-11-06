import { randomUUID } from "node:crypto";

import type { Context, Handler } from "hydrooj";
import { PRIV, UserModel, ValidationError } from "hydrooj";
import type { Collection } from "mongodb";

import {
    ANONYMOUS_USER_ID,
    BLOG_ALL,
    BLOG_DEFAULT,
    BLOG_FIRST_PAGE,
    BLOG_KNOWN,
    BLOG_NONE,
    BLOG_SETTINGS_ID,
    BLOG_SETTINGS_VERSION,
    BLOG_USERS_PER_PAGE,
    BlogCollections,
    BlogMessages,
    BlogRoles,
    BUILTIN_BLOG_ROLES,
    SYSTEM_DOMAIN,
} from "./constants";
import type { BlogIdentity } from "./permission";
import { BlogPolicy } from "./permission";
import type { BlogAssignment, BlogRole, BlogSettings } from "./types";

export { BUILTIN_BLOG_ROLES } from "./constants";
export type { BlogAssignment, BlogRole, BlogSettings } from "./types";

declare module "hydrooj" {
    interface Collections {
        [BlogCollections.Settings]: BlogSettings;
        [BlogCollections.UserRoles]: BlogAssignment;
    }
}

const requestPolicies = new WeakMap<Handler, Promise<BlogPolicy>>();

function configuredPermissionRoles(settings: BlogSettings) {
    const order = settings.permissionRoleOrder ?? [];
    return [
        ...order,
        ...settings.roles
            .filter((role) => !BUILTIN_BLOG_ROLES.includes(role.name) && !order.includes(role.id))
            .map((role) => role.id),
    ];
}

export function permissionMatrixRoles(settings: BlogSettings): BlogRole[] {
    const byId = new Map(settings.roles.map((role) => [role.id, role]));
    const configured = configuredPermissionRoles(settings)
        .map((id) => byId.get(id))
        .filter((role): role is BlogRole => !!role && role.name !== BlogRoles.Root);
    // Hydro enumerates its role dictionary before appending missing built-ins.
    const roles = Object.values(Object.fromEntries(configured.map((role) => [role.name, role])));
    for (const name of BUILTIN_BLOG_ROLES) {
        if (!roles.some((role) => role.name === name)) {
            const role = settings.roles.find((item) => item.name === name);
            if (role) roles.push(role);
        }
    }
    return roles;
}

export function initialSettings(): BlogSettings {
    return {
        _id: BLOG_SETTINGS_ID,
        version: BLOG_SETTINGS_VERSION,
        revision: 0,
        permissionRoleOrder: [],
        roles: [
            { id: BlogRoles.Guest, name: BlogRoles.Guest, permissions: BLOG_NONE.toString() },
            { id: BlogRoles.Default, name: BlogRoles.Default, permissions: BLOG_DEFAULT.toString() },
            { id: BlogRoles.Root, name: BlogRoles.Root, permissions: BLOG_ALL.toString() },
        ],
        deletedRoles: [],
    };
}

export function resolveBlogPolicy(user: BlogIdentity, settings: BlogSettings, assignment?: BlogAssignment | null) {
    let name: string = BlogRoles.Default;
    if (user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) name = BlogRoles.Root;
    else if (user._id <= ANONYMOUS_USER_ID || !user.hasPriv(PRIV.PRIV_USER_PROFILE)) name = BlogRoles.Guest;
    else if (assignment) {
        const role = settings.roles.find((r) => r.id === assignment.role);
        if (role) name = role.name === BlogRoles.Guest ? BlogRoles.Default : role.name;
        else if (!settings.deletedRoles.includes(assignment.role)) throw new ValidationError("role");
    }
    const role = settings.roles.find((r) => r.name === name);
    if (!role) throw new ValidationError("role");
    return new BlogPolicy(user, name, name === BlogRoles.Root ? BLOG_ALL : BigInt(role.permissions));
}

export class BlogSettingsModel {
    static settings: Collection<BlogSettings>;
    static users: Collection<BlogAssignment>;

    static async init(ctx: Context) {
        this.settings = ctx.db.collection(BlogCollections.Settings);
        this.users = ctx.db.collection(BlogCollections.UserRoles);
        await this.settings.updateOne({ _id: BLOG_SETTINGS_ID }, { $setOnInsert: initialSettings() }, { upsert: true });
        await ctx.db.ensureIndexes(this.users, { key: { role: 1 }, name: "blogUserRole" });
    }

    static async get() {
        const settings = await this.settings.findOne({ _id: BLOG_SETTINGS_ID });
        if (!settings || settings.version !== BLOG_SETTINGS_VERSION) {
            throw new ValidationError(BlogCollections.Settings);
        }
        return settings;
    }

    static async policy(user: BlogIdentity) {
        const [settings, assignment] = await Promise.all([
            this.get(),
            user._id > ANONYMOUS_USER_ID ? this.users.findOne({ _id: user._id }) : null,
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
            throw new ValidationError("revision", null, BlogMessages.SettingsChanged);
        }
        const result = await this.settings.updateOne(
            { _id: BLOG_SETTINGS_ID, revision },
            {
                $set: {
                    roles: settings.roles,
                    deletedRoles: settings.deletedRoles,
                    permissionRoleOrder: configuredPermissionRoles(settings),
                },
                $inc: { revision: 1 },
            },
        );
        if (!result.matchedCount) {
            throw new ValidationError("revision", null, BlogMessages.SettingsChanged);
        }
    }

    static async addRole(name: string, revision: number) {
        const settings = await this.get();
        if (settings.roles.some((r) => r.name === name)) {
            throw new ValidationError("role", null, BlogMessages.RoleExists);
        }
        const role = {
            id: randomUUID(),
            name,
            permissions: settings.roles.find((r) => r.name === BlogRoles.Default)!.permissions,
        };
        settings.permissionRoleOrder = [...configuredPermissionRoles(settings), role.id];
        settings.roles.push(role);
        await this.save(settings, revision);
        return role;
    }

    static async deleteRole(name: string, revision: number) {
        const [role] = await this.deleteRoles([name], revision);
        return role;
    }

    static async deleteRoles(names: string[], revision: number) {
        const settings = await this.get();
        const unique = [...new Set(names)];
        if (!unique.length) throw new ValidationError("role");
        const roles = unique.map((name) => {
            const role = settings.roles.find((r) => r.name === name);
            if (!role || BUILTIN_BLOG_ROLES.includes(name)) throw new ValidationError("role");
            return role;
        });
        const ids = new Set(roles.map((role) => role.id));
        settings.permissionRoleOrder = configuredPermissionRoles(settings).filter((id) => !ids.has(id));
        settings.roles = settings.roles.filter((r) => !ids.has(r.id));
        // Keep a tombstone: concurrent assignments and recreated names cannot revive deleted grants.
        settings.deletedRoles.push(...ids);
        await this.save(settings, revision);
        return roles;
    }

    static async permissions(changes: Record<string, bigint>, revision: number) {
        const settings = await this.get();
        const order = [...configuredPermissionRoles(settings)];
        for (const [name, permissions] of Object.entries(changes)) {
            if (name === BlogRoles.Root) continue;
            const role = settings.roles.find((r) => r.name === name);
            if (!role || permissions < BLOG_NONE || (permissions & BLOG_KNOWN) !== permissions) {
                throw new ValidationError("permissions");
            }
            role.permissions = permissions.toString();
            if (!order.includes(role.id)) order.push(role.id);
        }
        settings.permissionRoleOrder = order;
        await this.save(settings, revision);
    }

    static async assign(uid: number, name: string) {
        const [result] = await this.assignMany([uid], name);
        return result;
    }

    static async assignMany(uids: number[], name: string) {
        if (name === BlogRoles.Guest) throw new ValidationError("role");
        const unique = [...new Set(uids)];
        if (!unique.length || unique.some((uid) => !Number.isSafeInteger(uid) || uid <= ANONYMOUS_USER_ID)) {
            throw new ValidationError("uids");
        }
        const [settings, users, previous] = await Promise.all([
            this.get(),
            UserModel.getList(SYSTEM_DOMAIN, unique),
            this.users.find({ _id: { $in: unique } }).toArray(),
        ]);
        const role = settings.roles.find((r) => r.name === name);
        if (!role || unique.some((uid) => users[uid]?._id !== uid || !users[uid].hasPriv(PRIV.PRIV_USER_PROFILE))) {
            throw new ValidationError("role");
        }
        await this.users.bulkWrite(
            unique.map((uid) =>
                name === BlogRoles.Default
                    ? { deleteOne: { filter: { _id: uid } } }
                    : { updateOne: { filter: { _id: uid }, update: { $set: { role: role.id } }, upsert: true } },
            ),
        );
        const priorRoles = new Map(previous.map((assignment) => [assignment._id, assignment.role]));
        return unique.map((uid) => ({ uid, previous: priorRoles.get(uid) ?? BlogRoles.Default, role: role.id }));
    }

    static async listUsers(page: number) {
        const settings = await this.get();
        const visibleRoles = settings.roles.filter((r) => r.name !== BlogRoles.Guest && r.name !== BlogRoles.Default);
        const rows = await this.users
            .aggregate<{ entries: { _id: number; blogAssignment?: BlogAssignment }[]; count: { total: number }[] }>([
                { $match: { role: { $in: visibleRoles.map((role) => role.id) } } },
                {
                    $lookup: {
                        from: UserModel.coll.collectionName,
                        localField: "_id",
                        foreignField: "_id",
                        as: "user",
                    },
                },
                { $unwind: "$user" },
                {
                    $match: {
                        "user._id": { $gt: ANONYMOUS_USER_ID },
                        "user.priv": { $bitsAllSet: PRIV.PRIV_USER_PROFILE },
                    },
                },
                { $project: { _id: 1, blogAssignment: { _id: "$_id", role: "$role" } } },
                {
                    $unionWith: {
                        coll: UserModel.coll.collectionName,
                        pipeline: [
                            {
                                $match: {
                                    _id: { $gt: ANONYMOUS_USER_ID },
                                    priv: { $bitsAllSet: PRIV.PRIV_USER_PROFILE | PRIV.PRIV_EDIT_SYSTEM },
                                },
                            },
                            { $project: { _id: 1 } },
                        ],
                    },
                },
                { $group: { _id: "$_id", blogAssignment: { $first: "$blogAssignment" } } },
                { $sort: { _id: 1 } },
                {
                    $facet: {
                        entries: [
                            { $skip: (page - BLOG_FIRST_PAGE) * BLOG_USERS_PER_PAGE },
                            { $limit: BLOG_USERS_PER_PAGE },
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
