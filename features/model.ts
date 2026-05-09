import type { Filter, NumberKeys, ObjectId } from "hydrooj";
import { DocumentModel } from "hydrooj";

import type { BlogDoc } from "./types";

export const TYPE_BLOG = 70 as const;
const SYSTEM_DOMAIN = "system" as const;

declare module "hydrooj" {
    interface Model {
        blog: typeof BlogModel;
    }
    interface DocType {
        [TYPE_BLOG]: BlogDoc;
    }
}

export class BlogModel {
    static async add(owner: number, title: string, content: string, ip?: string): Promise<ObjectId> {
        return await DocumentModel.add(
            SYSTEM_DOMAIN,
            content,
            owner,
            TYPE_BLOG,
            null /* docId */,
            null /* parentType */,
            null /* parentId */,
            {
                title,
                ip,
                nReply: 0,
                updateAt: new Date(),
                views: 0,
            },
        );
    }

    static async get(did: ObjectId): Promise<BlogDoc> {
        return (await DocumentModel.get(SYSTEM_DOMAIN, TYPE_BLOG, did)) as BlogDoc;
    }

    static async edit(did: ObjectId, title: string, content: string): Promise<BlogDoc> {
        return await DocumentModel.set(SYSTEM_DOMAIN, TYPE_BLOG, did, { title, content });
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
        await DocumentModel.setStatus(SYSTEM_DOMAIN, TYPE_BLOG, did, uid, { star });
    }

    static async getStatus(did: ObjectId, uid: number): Promise<any> {
        return await DocumentModel.getStatus(SYSTEM_DOMAIN, TYPE_BLOG, did, uid);
    }

    static async setStatus(did: ObjectId, uid: number, $set: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        return await DocumentModel.setStatus(SYSTEM_DOMAIN, TYPE_BLOG, did, uid, $set);
    }
}

global.Hydro.model.blog = BlogModel;
