import type { ObjectId } from "hydrooj";

import type { BLOG_SETTINGS_ID, BLOG_SETTINGS_VERSION } from "./constants";
import type { TYPE_BLOG } from "./model";

export interface BlogDoc {
    _id: ObjectId;
    docType: typeof TYPE_BLOG;
    docId: ObjectId;
    owner: number;
    title: string;
    content: string;
    ip?: string;
    updateAt: Date;
    draft?: boolean;
    firstPublishAt?: Date;
    pin?: boolean;

    // statistics
    nReply: number;
    views: number;
    reply: BlogReplyDoc[];
    react: Record<string, number>;
}

export interface BlogReplyDoc {
    _id: ObjectId;
    owner: number;
    content: string;
    ip?: string;
}

export interface BlogStatusDoc {
    docType: typeof TYPE_BLOG;
    docId: ObjectId;
    view?: boolean;
    star?: boolean;
}

export type BlogVisibility = Pick<BlogDoc, "owner" | "draft">;
export type BlogContentUpdate = Partial<Pick<BlogDoc, "title" | "content" | "draft" | "pin">>;
export type BlogUpdate = BlogContentUpdate & Partial<Pick<BlogDoc, "ip">>;

export interface BlogRole {
    id: string;
    name: string;
    permissions: string;
}

export interface BlogSettings {
    _id: typeof BLOG_SETTINGS_ID;
    version: typeof BLOG_SETTINGS_VERSION;
    revision: number;
    roles: BlogRole[];
    permissionRoleOrder?: string[];
    deletedRoles: string[];
}

export interface BlogAssignment {
    _id: number;
    role: string;
}
