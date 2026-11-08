import type { ObjectId, User } from "hydrooj";
import { DiscussionNotFoundError, Handler, param, Types, UserModel, UserNotFoundError } from "hydrooj";

import { BlogModel } from "../articles/article.model";
import { BlogSettingsModel } from "../settings/settings.model";
import type { BlogPolicy } from "../settings/settings.policy";
import { BlogConfirmMessages, BlogPermissions, ReviewMessages, SYSTEM_DOMAIN } from "../shared/constants";
import type { BlogDoc } from "../shared/types";

export class BlogBaseHandler extends Handler {
    noCheckPermView = true;
    blog!: BlogPolicy;

    async loadBlog() {
        this.blog = await BlogSettingsModel.forRequest(this);
        this.blog.require(BlogPermissions.ACCESS);
        this.UiContext.blogConfirmations = Object.fromEntries(
            [...Object.values(BlogConfirmMessages), ReviewMessages.ResetConfirm].map((key) => [
                key,
                this.translate(key),
            ]),
        );
    }

    async __prepare(_?: unknown, _uid?: number) {
        await this.loadBlog();
    }
}

export class BlogUserBaseHandler extends BlogBaseHandler {
    udoc!: User;

    @param("uid", Types.Int)
    async __prepare(_, uid: number) {
        await this.loadBlog();
        const udoc = await UserModel.getById(SYSTEM_DOMAIN, uid);
        if (!udoc) throw new UserNotFoundError(uid);
        this.udoc = udoc;
    }
}

export class BlogUserPostBaseHandler extends BlogUserBaseHandler {
    ddoc!: BlogDoc; // ddoc will always be set in _prepare

    @param("did", Types.ObjectId)
    async _prepare(_, did: ObjectId) {
        const ddoc = await BlogModel.get(did);
        if (!ddoc || !this.udoc.own(ddoc, true)) throw new DiscussionNotFoundError(SYSTEM_DOMAIN, did);
        this.ddoc = ddoc;
    }

    requireRead() {
        this.blog.requireRead(this.ddoc);
    }
}
