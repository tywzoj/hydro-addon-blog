import { CreateError, ForbiddenError, PRIV, PrivilegeError } from "hydrooj";

import type { BlogAction, BlogPermission } from "./constants";
import {
    ANONYMOUS_USER_ID,
    BLOG_PERM,
    BLOG_PERMISSION_LABELS,
    BlogActions,
    BlogMessages,
    BlogPermissions,
} from "./constants";
import type { BlogVisibility } from "./types";

export type { BlogAction, BlogPermission } from "./constants";
export { BLOG_ALL, BLOG_DEFAULT, BLOG_KNOWN, BLOG_PERM } from "./constants";

export const BLOG_PERMISSIONS = Object.entries(BLOG_PERM).map(([name, bit], index) => ({
    name: name as BlogPermission,
    bit,
    index,
    label: BLOG_PERMISSION_LABELS[name as BlogPermission],
    family: name === BlogPermissions.MANAGE_SETTINGS ? BlogMessages.Settings : BlogMessages.Articles,
}));

export const BlogPermissionError = CreateError("BlogPermissionError", ForbiddenError, BlogMessages.PermissionDenied);

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
        return this.user._id > ANONYMOUS_USER_ID && this.user.hasPriv(PRIV.PRIV_USER_PROFILE);
    }

    has(permission: BlogPermission) {
        return (this.mask & BLOG_PERM[permission]) === BLOG_PERM[permission];
    }

    require(permission: BlogPermission) {
        if (this.has(permission)) return;
        if (!this.authenticated) throw new PrivilegeError(PRIV.PRIV_USER_PROFILE);
        throw new BlogPermissionError(BLOG_PERMISSION_LABELS[permission]);
    }

    requireLogin() {
        if (!this.authenticated) throw new PrivilegeError(PRIV.PRIV_USER_PROFILE);
    }

    key(action: BlogAction, owner: number): BlogPermission {
        return `${action}_${this.authenticated && owner === this.user._id ? "OWN" : "OTHERS"}`;
    }

    can(action: BlogAction, owner: number) {
        return this.has(BlogPermissions.ACCESS) && this.has(this.key(action, owner));
    }

    requireAction(action: BlogAction, owner: number) {
        this.require(BlogPermissions.ACCESS);
        this.require(this.key(action, owner));
    }

    readable(doc: BlogVisibility) {
        return (
            this.has(BlogPermissions.ACCESS) &&
            (doc.draft ? this.can(BlogActions.ViewDraft, doc.owner) : this.has(BlogPermissions.VIEW_PUBLISHED))
        );
    }

    requireRead(doc: BlogVisibility) {
        this.require(BlogPermissions.ACCESS);
        this.require(doc.draft ? this.key(BlogActions.ViewDraft, doc.owner) : BlogPermissions.VIEW_PUBLISHED);
    }

    controls(doc: BlogVisibility) {
        const write = this.authenticated && this.readable(doc);
        return {
            edit: write && this.can(BlogActions.Edit, doc.owner),
            publish: write && this.can(BlogActions.Publish, doc.owner),
            unpublish: write && this.can(BlogActions.Unpublish, doc.owner),
            pin: write && this.can(BlogActions.Pin, doc.owner),
            delete: write && this.can(BlogActions.Delete, doc.owner),
            star: write && this.has(BlogPermissions.STAR),
        };
    }
}
