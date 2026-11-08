import type { ObjectId } from "hydrooj";

import type {
    BLOG_SETTINGS_ID,
    BLOG_SETTINGS_VERSION,
    REVIEW_RUNTIME_ID,
    ReviewDecision,
    ReviewMode,
    ReviewReason,
    TYPE_BLOG,
    TYPE_BLOG_COMMENT,
} from "./constants";

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
    writeRevision?: number;
    contentVersion?: number;
    counterEpoch?: number;
    reportCount?: number;
    rejectionCount?: number;
    requiresReview?: boolean;
    reviewReason?: ReviewReason;
    reviewPending?: boolean;
    reviewGeneration?: number;
    reviewQueuedAt?: Date;
    reportApprovedVersion?: number;
    pendingReportWrite?: BlogReport;
    lastReview?: { decision: ReviewDecision; reviewer: number; comments: string; at: Date; version: number };

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
    nLike?: number;
}

export interface BlogCommentDoc extends BlogReplyDoc {
    docId: ObjectId;
    domainId: string;
    docType: typeof TYPE_BLOG_COMMENT;
    parentType: typeof TYPE_BLOG;
    parentId: ObjectId;
    reply?: BlogReplyDoc[];
}

export interface BlogCommentStatus {
    domainId: string;
    docType: typeof TYPE_BLOG_COMMENT;
    docId: ObjectId;
    uid: number;
    parentId: ObjectId;
    commentId: ObjectId;
    liked: boolean;
    transitionId?: string;
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
    review?: BlogReviewSettings;
}

export interface BlogReviewSettings {
    mode: ReviewMode;
    reportLimit: number;
    rejectionLimit: number;
    reminders: boolean;
    intervalMinutes: number;
    reminderRevision: number;
    reminderChangedAt?: Date;
}

export interface BlogReport {
    _id: string;
    articleId: ObjectId;
    reporter: number;
    version: number;
    comments: string;
    acceptedAt: Date;
    epoch: number;
    operationId: string;
    revision: number;
}

export interface BlogReviewRuntime {
    _id: typeof REVIEW_RUNTIME_ID;
    taskId: ObjectId;
    configRevision: number;
    nextSummaryAt: Date;
    runId?: string;
    leaseUntil?: Date;
}

export interface BlogAssignment {
    _id: number;
    role: string;
}
