import type { ObjectId } from "hydrooj";

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
    hidden?: boolean;
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
