/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable no-empty-pattern */

import type { Context, ObjectId } from "hydrooj";
import { DiscussionNotFoundError, Handler, OplogModel, param, PRIV, Types, UserModel } from "hydrooj";

import { BlogModel } from "./model";
import type { BlogDoc } from "./types";

class BlogHandler extends Handler {
    ddoc?: BlogDoc;

    @param("did", Types.ObjectId, true)
    async _prepare(domainId: string, did: ObjectId) {
        if (did) {
            this.ddoc = await BlogModel.get(did);
            if (!this.ddoc) throw new DiscussionNotFoundError(domainId, did);
        }
    }
}

class BlogUserHandler extends BlogHandler {
    @param("uid", Types.Int)
    @param("page", Types.PositiveInt, true)
    async get(domainId: string, uid: number, page = 1) {
        const [ddocs, dpcount] = await this.ctx.db.paginate(BlogModel.getMulti({ owner: uid }), page, 10);
        const udoc = await UserModel.getById(domainId, uid);
        this.response.template = "blog_main.html";
        this.response.body = {
            ddocs,
            dpcount,
            udoc,
            page,
        };
    }
}

class BlogDetailHandler extends BlogHandler {
    @param("did", Types.ObjectId)
    async get({ domainId }, did: ObjectId) {
        const dsdoc = this.user.hasPriv(PRIV.PRIV_USER_PROFILE) ? await BlogModel.getStatus(did, this.user._id) : null;
        const udoc = await UserModel.getById(domainId, this.ddoc!.owner);
        if (!dsdoc?.view) {
            await Promise.all([
                BlogModel.inc(did, "views", 1),
                BlogModel.setStatus(did, this.user._id, { view: true }),
            ]);
        }
        this.response.template = "blog_detail.html";
        this.response.body = {
            ddoc: this.ddoc,
            dsdoc,
            udoc,
        };
    }

    async post() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    @param("did", Types.ObjectId)
    async postStar({}, did: ObjectId) {
        await BlogModel.setStar(did, this.user._id, true);
        this.back({ star: true });
    }

    @param("did", Types.ObjectId)
    async postUnstar({}, did: ObjectId) {
        await BlogModel.setStar(did, this.user._id, false);
        this.back({ star: false });
    }
}

class BlogEditHandler extends BlogHandler {
    async get() {
        this.response.template = "blog_edit.html";
        this.response.body = { ddoc: this.ddoc };
    }

    @param("title", Types.Title)
    @param("content", Types.Content)
    async postCreate({}, title: string, content: string) {
        await this.limitRate("add_blog", 3600, 60);
        const did = await BlogModel.add(this.user._id, title, content, this.request.ip);
        this.response.body = { did };
        this.response.redirect = this.url("blog_detail", { uid: this.user._id, did });
    }

    @param("did", Types.ObjectId)
    @param("title", Types.Title)
    @param("content", Types.Content)
    async postUpdate({}, did: ObjectId, title: string, content: string) {
        if (!this.user.own(this.ddoc!)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await Promise.all([BlogModel.edit(did, title, content), OplogModel.log(this, "blog.edit", this.ddoc)]);
        this.response.body = { did };
        this.response.redirect = this.url("blog_detail", { uid: this.user._id, did });
    }

    @param("did", Types.ObjectId)
    async postDelete({}, did: ObjectId) {
        if (!this.user.own(this.ddoc!)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await Promise.all([BlogModel.del(did), OplogModel.log(this, "blog.delete", this.ddoc)]);
        this.response.redirect = this.url("blog_main", { uid: this.ddoc!.owner });
    }
}

export function applyHandler(ctx: Context) {
    ctx.Route("blog_main", "/blog/:uid", BlogUserHandler);
    ctx.Route("blog_create", "/blog/:uid/create", BlogEditHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route("blog_detail", "/blog/:uid/:did", BlogDetailHandler);
    ctx.Route("blog_edit", "/blog/:uid/:did/edit", BlogEditHandler, PRIV.PRIV_USER_PROFILE);
}
