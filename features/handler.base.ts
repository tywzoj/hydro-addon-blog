import type { ObjectId, User } from "hydrooj";
import { DiscussionNotFoundError, Handler, param, Types, UserModel, UserNotFoundError } from "hydrooj";

import { SYSTEM_DOMAIN } from "./constants";
import { BlogModel } from "./model";
import type { BlogDoc } from "./types";

export class BlogBaseHandler extends Handler {}

export class BlogUserBaseHandler extends BlogBaseHandler {
    udoc!: User;

    @param("uid", Types.Int)
    async _prepare(_, uid: number) {
        const udoc = await UserModel.getById(SYSTEM_DOMAIN, uid);
        if (!udoc) throw new UserNotFoundError(uid);
        this.udoc = udoc;
    }
}

export class BlogUserPostBaseHandler extends BlogUserBaseHandler {
    ddoc!: BlogDoc; // ddoc will always be set in _prepare

    @param("did", Types.ObjectId)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    async _prepare(args: any, did: ObjectId) {
        await super._prepare.apply(this, [args] as any);
        const ddoc = await BlogModel.get(did);
        if (!ddoc) throw new DiscussionNotFoundError(SYSTEM_DOMAIN, did);
        this.ddoc = ddoc;
    }
}
