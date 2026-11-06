import { randomUUID } from "node:crypto";

import type { Context, ObjectId } from "hydrooj";
import { DocumentModel, DocumentNotFoundError, ValidationError } from "hydrooj";
import type { Collection, Filter } from "mongodb";

import { BlogMessages, SYSTEM_DOMAIN, TYPE_BLOG, TYPE_BLOG_COMMENT } from "./constants";
import type { BlogCommentDoc, BlogCommentStatus, BlogDoc, BlogReplyDoc } from "./types";

declare module "hydrooj" {
    interface DocType {
        [TYPE_BLOG_COMMENT]: BlogCommentDoc;
    }
    interface DocStatusType {
        [TYPE_BLOG_COMMENT]: BlogCommentStatus;
    }
}

export class BlogCommentModel {
    static coll = DocumentModel.coll as Collection<BlogCommentDoc>;
    static statuses = DocumentModel.collStatus as Collection<BlogCommentStatus>;

    static filter(did: ObjectId): Filter<BlogCommentDoc> {
        return { domainId: SYSTEM_DOMAIN, docType: TYPE_BLOG_COMMENT, parentType: TYPE_BLOG, parentId: did };
    }

    static async requirePublished(did: ObjectId) {
        const doc = (await DocumentModel.get(SYSTEM_DOMAIN, TYPE_BLOG, did)) as BlogDoc | null;
        if (!doc) throw new ValidationError("post", null, BlogMessages.CommentUnavailable);
        if (doc.draft) throw new ValidationError("post", null, BlogMessages.CommentsPublishedOnly);
    }

    static async get(did: ObjectId, drid: ObjectId, drrid?: ObjectId) {
        const comment = await this.coll.findOne({ ...this.filter(did), docId: drid });
        if (!comment) throw new DocumentNotFoundError(SYSTEM_DOMAIN, drid);
        const target = drrid ? comment.reply?.find((reply) => reply._id.equals(drrid)) : comment;
        if (!target) throw new DocumentNotFoundError(SYSTEM_DOMAIN, drrid);
        return { comment, target };
    }

    static getMulti(did: ObjectId) {
        return DocumentModel.getMulti(SYSTEM_DOMAIN, TYPE_BLOG_COMMENT, {
            parentType: TYPE_BLOG,
            parentId: did,
        })
            .sort({ _id: -1 })
            .project<BlogCommentDoc>({ ip: 0, "reply.ip": 0 });
    }

    static async getLikes(did: ObjectId, ids: ObjectId[], uid: number): Promise<Record<string, boolean>> {
        if (!ids.length || uid <= 0) return {};
        const statuses = await this.statuses
            .find({
                domainId: SYSTEM_DOMAIN,
                docType: TYPE_BLOG_COMMENT,
                parentId: did,
                docId: { $in: ids },
                uid,
                liked: true,
            })
            .project<Pick<BlogCommentStatus, "docId">>({ docId: 1 })
            .toArray();
        return Object.fromEntries(statuses.map((status) => [status.docId.toHexString(), true]));
    }

    static async add(did: ObjectId, owner: number, content: string, ip: string) {
        await this.requirePublished(did);
        const drid = await DocumentModel.add(SYSTEM_DOMAIN, content, owner, TYPE_BLOG_COMMENT, null, TYPE_BLOG, did, {
            ip,
            nLike: 0,
            reply: [],
        });
        const parent: unknown = await DocumentModel.coll.findOneAndUpdate(
            { domainId: SYSTEM_DOMAIN, docType: TYPE_BLOG, docId: did, draft: { $ne: true } },
            { $inc: { nReply: 1 } },
            { returnDocument: "after" },
        );
        if (!parent) {
            await this.coll.deleteOne({ ...this.filter(did), docId: drid });
            await this.clearStatuses(did, drid);
            throw new ValidationError("post", null, BlogMessages.CommentUnavailable);
        }
        return drid;
    }

    static async addTail(did: ObjectId, drid: ObjectId, owner: number, content: string, ip: string) {
        await this.requirePublished(did);
        await this.get(did, drid);
        const [comment, id] = await DocumentModel.push(
            SYSTEM_DOMAIN,
            TYPE_BLOG_COMMENT,
            drid,
            "reply",
            content,
            owner,
            { ip, nLike: 0 },
        );
        if (!comment) throw new DocumentNotFoundError(SYSTEM_DOMAIN, drid);
        try {
            await this.requirePublished(did);
            await this.get(did, drid, id);
        } catch (error) {
            await DocumentModel.deleteSub(SYSTEM_DOMAIN, TYPE_BLOG_COMMENT, drid, "reply", id);
            await this.clearStatuses(did, drid, id);
            throw error;
        }
        return id;
    }

    static async clearStatuses(did: ObjectId, drid?: ObjectId, drrid?: ObjectId) {
        await this.statuses.deleteMany({
            domainId: SYSTEM_DOMAIN,
            docType: TYPE_BLOG_COMMENT,
            parentId: did,
            ...(drid ? { commentId: drid } : {}),
            ...(drrid ? { docId: drrid } : {}),
        });
    }

    static async delete(did: ObjectId, drid: ObjectId, drrid?: ObjectId) {
        const filter = { ...this.filter(did), docId: drid };
        if (drrid) {
            await this.coll.updateOne({ ...filter, "reply._id": drrid }, { $pull: { reply: { _id: drrid } } });
        } else {
            const removed = await this.coll.findOneAndDelete(filter);
            if (removed) await DocumentModel.inc(SYSTEM_DOMAIN, TYPE_BLOG, did, "nReply", -1);
        }
        await this.clearStatuses(did, drid, drrid);
    }

    static async deleteForArticle(did: ObjectId) {
        await this.coll.deleteMany(this.filter(did));
        await this.clearStatuses(did);
    }

    static async like(did: ObjectId, drid: ObjectId, drrid: ObjectId | undefined, uid: number, liked: boolean) {
        await this.requirePublished(did);
        await this.get(did, drid, drrid);
        const id = drrid || drid;
        const identity = { domainId: SYSTEM_DOMAIN, docType: TYPE_BLOG_COMMENT, docId: id, uid };
        const transitionId = randomUUID();
        const targetFilter = { ...this.filter(did), docId: drid, ...(drrid ? { "reply._id": drrid } : {}) };
        const countDelta = liked ? 1 : -1;
        let changed: BlogCommentStatus | null = null;
        try {
            changed = await this.statuses.findOneAndUpdate(
                { ...identity, liked: liked ? { $ne: true } : true },
                { $set: { liked, parentId: did, commentId: drid, transitionId } },
                { upsert: liked, returnDocument: "after" },
            );
        } catch (error) {
            // A concurrent request already stored the same desired state.
            if (!liked || !(error instanceof Error) || !("code" in error) || error.code !== 11000) throw error;
        }
        if (changed) {
            const result = await this.coll.updateOne(targetFilter, {
                $inc: drrid ? { "reply.$.nLike": countDelta } : { nLike: countDelta },
            });
            if (!result.matchedCount) {
                await this.clearStatuses(did, drid, drrid);
                throw new DocumentNotFoundError(SYSTEM_DOMAIN, id);
            }
        }
        try {
            await this.requirePublished(did);
        } catch (error) {
            if (changed) {
                // Only undo our transition; a later request owns any newer state and its count.
                const restored = await this.statuses.updateOne(
                    { ...identity, transitionId },
                    { $set: { liked: !liked }, $unset: { transitionId: "" } },
                );
                if (restored.matchedCount) {
                    await this.coll.updateOne(targetFilter, {
                        $inc: drrid ? { "reply.$.nLike": -countDelta } : { nLike: -countDelta },
                    });
                }
            }
            throw error;
        }
        const [{ target }, status] = await Promise.all([this.get(did, drid, drrid), this.statuses.findOne(identity)]);
        return { drid, ...(drrid ? { drrid } : {}), nLike: target.nLike || 0, liked: status?.liked || false };
    }
}

export async function ensureCommentIndexes(ctx: Context) {
    await ctx.db.ensureIndexes(BlogCommentModel.coll, {
        name: "blogCommentsByArticle",
        key: { parentId: 1, _id: -1 },
        partialFilterExpression: { domainId: SYSTEM_DOMAIN, docType: TYPE_BLOG_COMMENT, parentType: TYPE_BLOG },
    });
    await ctx.db.ensureIndexes(BlogCommentModel.statuses, {
        name: "blogCommentLikesByArticle",
        key: { parentId: 1, commentId: 1 },
        partialFilterExpression: { domainId: SYSTEM_DOMAIN, docType: TYPE_BLOG_COMMENT },
    });
}

export function commentOwners(comments: BlogCommentDoc[]) {
    return [...new Set(comments.flatMap((comment) => [comment.owner, ...(comment.reply || []).map((r) => r.owner)]))];
}

export function commentIds(comments: BlogCommentDoc[]) {
    return comments.flatMap((comment) => [comment.docId, ...(comment.reply || []).map((r: BlogReplyDoc) => r._id)]);
}
