import { ObjectId } from "hydrooj";

import type { BlogDoc } from "../../features/types";

export function makeBlog(update: Partial<BlogDoc> = {}): BlogDoc {
    return {
        _id: new ObjectId("000000000000000000000001"),
        docId: new ObjectId("000000000000000000000002"),
        docType: 70,
        owner: 1,
        title: "Test post",
        content: "Test content",
        updateAt: new Date("2026-01-01T00:00:00Z"),
        draft: true,
        pin: false,
        nReply: 0,
        views: 0,
        reply: [],
        react: {},
        ...update,
    };
}
