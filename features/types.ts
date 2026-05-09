import type { ObjectId } from "hydrooj";

import type { TYPE_BLOG } from "./model";

export interface BlogDoc {
    docType: typeof TYPE_BLOG;
    docId: ObjectId;
    owner: number;
    title: string;
    content: string;
    ip: string;
    updateAt: Date;
    nReply: number;
    views: number;
    reply: any[];
    react: Record<string, number>;
}
