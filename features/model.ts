import type { Filter, NumberKeys, ObjectId } from "hydrooj";
import { DocumentModel } from "hydrooj";

import { SYSTEM_DOMAIN } from "./constants";
import type { BlogDoc, BlogStatusDoc } from "./types";

export const TYPE_BLOG = 70 as const;

declare module "hydrooj" {
    interface Model {
        blog: typeof BlogModel;
    }
    interface DocType {
        [TYPE_BLOG]: BlogDoc;
    }

    interface DocStatusType {
        [TYPE_BLOG]: BlogStatusDoc;
    }
}

export class BlogModel {
    static async add(
        owner: number,
        title: string,
        content: string,
        draft: boolean,
        pin: boolean,
        ip: string,
    ): Promise<ObjectId> {
        const ddoc: Partial<BlogDoc> = {
            title,
            draft,
            pin,
            ip,
            nReply: 0,
            updateAt: new Date(),
            views: 0,
        };

        if (!draft) {
            ddoc.firstPublishAt = ddoc.updateAt;
        }

        return await DocumentModel.add(
            SYSTEM_DOMAIN,
            content,
            owner,
            TYPE_BLOG,
            null /* docId */,
            null /* parentType */,
            null /* parentId */,
            ddoc,
        );
    }

    static async get(did: ObjectId): Promise<BlogDoc | null> {
        const ddoc = (await DocumentModel.get(SYSTEM_DOMAIN, TYPE_BLOG, did)) as BlogDoc | null;

        // For the backward compatibility, if the firstPublishAt is not set, we set it to updateAt.
        if (ddoc && !ddoc.draft && !ddoc.firstPublishAt) {
            ddoc.firstPublishAt = ddoc.updateAt;
        }

        return ddoc;
    }

    static async edit(
        ddoc: BlogDoc,
        update: Partial<Pick<BlogDoc, "title" | "content" | "draft" | "pin" | "ip">>,
    ): Promise<BlogDoc> {
        const $set: Partial<BlogDoc> = {
            ...update,
            updateAt: new Date(),
        };

        if ($set.draft === false && !ddoc.firstPublishAt) {
            $set.firstPublishAt = $set.updateAt;
        }

        return await DocumentModel.set(SYSTEM_DOMAIN, TYPE_BLOG, ddoc.docId, $set);
    }

    static async inc(did: ObjectId, key: NumberKeys<BlogDoc>, value: number): Promise<BlogDoc> {
        return (await DocumentModel.inc(SYSTEM_DOMAIN, TYPE_BLOG, did, key, value)) as BlogDoc;
    }

    static async del(did: ObjectId): Promise<never> {
        return (await Promise.all([
            DocumentModel.deleteOne(SYSTEM_DOMAIN, TYPE_BLOG, did),
            DocumentModel.deleteMultiStatus(SYSTEM_DOMAIN, TYPE_BLOG, { docId: did }),
        ])) as never;
    }

    static async count(query: Filter<BlogDoc>) {
        return await DocumentModel.count(SYSTEM_DOMAIN, TYPE_BLOG, query);
    }

    static getMulti(query: Filter<BlogDoc> = {}) {
        return DocumentModel.getMulti(SYSTEM_DOMAIN, TYPE_BLOG, query).sort({ _id: -1 });
    }

    static async addReply(did: ObjectId, owner: number, content: string, ip: string): Promise<ObjectId> {
        const [[, drid]] = await Promise.all([
            DocumentModel.push(SYSTEM_DOMAIN, TYPE_BLOG, did, "reply", content, owner, { ip }),
            DocumentModel.incAndSet(SYSTEM_DOMAIN, TYPE_BLOG, did, "nReply", 1, { updateAt: new Date() }),
        ]);
        return drid;
    }

    static async setStar(did: ObjectId, uid: number, star: boolean): Promise<void> {
        await this.setStatus(did, uid, { star });
    }

    static async getStatus(did: ObjectId, uid: number): Promise<BlogStatusDoc> {
        return (await DocumentModel.getStatus(SYSTEM_DOMAIN, TYPE_BLOG, did, uid)) as BlogStatusDoc;
    }

    static async setStatus(
        did: ObjectId,
        uid: number,
        $set: Omit<BlogStatusDoc, "docType" | "docId">,
    ): Promise<BlogStatusDoc> {
        return (await DocumentModel.setStatus(SYSTEM_DOMAIN, TYPE_BLOG, did, uid, $set)) as BlogStatusDoc;
    }
}

global.Hydro.model.blog = BlogModel;
