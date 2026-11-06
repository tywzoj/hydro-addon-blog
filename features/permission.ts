import { CreateError, ForbiddenError, PRIV, PrivilegeError } from "hydrooj";

import type { BlogDoc } from "./types";

export const BLOG_PERM = {
    ACCESS: 1n << 0n,
    VIEW_PUBLISHED: 1n << 1n,
    VIEW_DRAFT_OWN: 1n << 2n,
    VIEW_DRAFT_OTHERS: 1n << 3n,
    CREATE_OWN: 1n << 4n,
    CREATE_OTHERS: 1n << 5n,
    EDIT_OWN: 1n << 6n,
    EDIT_OTHERS: 1n << 7n,
    PUBLISH_OWN: 1n << 8n,
    PUBLISH_OTHERS: 1n << 9n,
    UNPUBLISH_OWN: 1n << 10n,
    UNPUBLISH_OTHERS: 1n << 11n,
    PIN_OWN: 1n << 12n,
    PIN_OTHERS: 1n << 13n,
    DELETE_OWN: 1n << 14n,
    DELETE_OTHERS: 1n << 15n,
    STAR: 1n << 16n,
    MANAGE_SETTINGS: 1n << 17n,
} as const;

export type BlogPermission = keyof typeof BLOG_PERM;
export type BlogAction = "VIEW_DRAFT" | "CREATE" | "EDIT" | "PUBLISH" | "UNPUBLISH" | "PIN" | "DELETE";
export const BLOG_ALL = -1n;
export const BLOG_KNOWN = Object.values(BLOG_PERM).reduce((mask, bit) => mask | bit, 0n);
export const BLOG_DEFAULT =
    BLOG_PERM.ACCESS |
    BLOG_PERM.VIEW_PUBLISHED |
    BLOG_PERM.VIEW_DRAFT_OWN |
    BLOG_PERM.CREATE_OWN |
    BLOG_PERM.EDIT_OWN |
    BLOG_PERM.PUBLISH_OWN |
    BLOG_PERM.UNPUBLISH_OWN |
    BLOG_PERM.PIN_OWN |
    BLOG_PERM.DELETE_OWN |
    BLOG_PERM.STAR;

export const BLOG_PERMISSIONS = Object.entries(BLOG_PERM).map(([name, bit], index) => ({
    name: name as BlogPermission,
    bit,
    index,
    label: `blog_perm_${name}`,
    family: name === "MANAGE_SETTINGS" ? "Blog settings" : "Blog articles",
}));

export const BlogPermissionError = CreateError(
    "BlogPermissionError",
    ForbiddenError,
    "You do not have the required blog permission: {0}.",
);

export interface BlogIdentity {
    _id: number;
    hasPriv: (privilege: number) => boolean;
}

export class BlogPolicy {
    constructor(
        readonly user: BlogIdentity,
        readonly role: string,
        readonly mask: bigint,
    ) {}

    get authenticated() {
        return this.user._id > 0 && this.user.hasPriv(PRIV.PRIV_USER_PROFILE);
    }

    has(permission: BlogPermission) {
        return (this.mask & BLOG_PERM[permission]) === BLOG_PERM[permission];
    }

    require(permission: BlogPermission) {
        if (this.has(permission)) return;
        if (!this.authenticated) throw new PrivilegeError(PRIV.PRIV_USER_PROFILE);
        throw new BlogPermissionError(`blog_perm_${permission}`);
    }

    requireLogin() {
        if (!this.authenticated) throw new PrivilegeError(PRIV.PRIV_USER_PROFILE);
    }

    key(action: BlogAction, owner: number): BlogPermission {
        return `${action}_${this.authenticated && owner === this.user._id ? "OWN" : "OTHERS"}`;
    }

    can(action: BlogAction, owner: number) {
        return this.has("ACCESS") && this.has(this.key(action, owner));
    }

    requireAction(action: BlogAction, owner: number) {
        this.require("ACCESS");
        this.require(this.key(action, owner));
    }

    readable(doc: Pick<BlogDoc, "owner" | "draft">) {
        return this.has("ACCESS") && (doc.draft ? this.can("VIEW_DRAFT", doc.owner) : this.has("VIEW_PUBLISHED"));
    }

    requireRead(doc: Pick<BlogDoc, "owner" | "draft">) {
        this.require("ACCESS");
        this.require(doc.draft ? this.key("VIEW_DRAFT", doc.owner) : "VIEW_PUBLISHED");
    }

    controls(doc: Pick<BlogDoc, "owner" | "draft">) {
        const write = this.authenticated && this.readable(doc);
        return {
            edit: write && this.can("EDIT", doc.owner),
            publish: write && this.can("PUBLISH", doc.owner),
            unpublish: write && this.can("UNPUBLISH", doc.owner),
            pin: write && this.can("PIN", doc.owner),
            delete: write && this.can("DELETE", doc.owner),
            star: write && this.has("STAR"),
        };
    }
}
