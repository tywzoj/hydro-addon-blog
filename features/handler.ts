import type { Context, ObjectId } from "hydrooj";
import { DiscussionNotFoundError, Handler, OplogModel, param, PRIV, Types, UserModel } from "hydrooj";

import { BlogModel } from "./model";
import type { BlogDoc } from "./types";

const ROUTE_BLOG_LIST_USER = "blog_list_user" as const;
const ROUTE_BLOG_DETAIL = "blog_detail" as const;
const ROUTE_BLOG_CREATE = "blog_create" as const;
const ROUTE_BLOG_EDIT = "blog_edit" as const;

class BlogListUserHandler extends Handler {
    @param("uid", Types.Int)
    @param("page", Types.PositiveInt, true)
    async get(domainId: string, uid: number, page = 1) {
        const [ddocs, dpcount] = await this.ctx.db.paginate(BlogModel.getMulti({ owner: uid }), page, 10);
        const udoc = await UserModel.getById(domainId, uid);
        this.response.template = "blog_list.html";
        this.response.body = {
            ddocs,
            dpcount,
            udoc,
            page,
        };
    }
}

class BlogBaseHandler extends Handler {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore ddoc will always be set in _prepare, so we can ignore the type error here
    ddoc: BlogDoc;

    @param("did", Types.ObjectId, true)
    async _prepare(domainId: string, did: ObjectId) {
        this.ddoc = await BlogModel.get(did);
        if (!this.ddoc) throw new DiscussionNotFoundError(domainId, did);
    }
}

class BlogDetailHandler extends BlogBaseHandler {
    @param("did", Types.ObjectId)
    async get(domainId: string, did: ObjectId) {
        const dsdoc = this.user.hasPriv(PRIV.PRIV_USER_PROFILE) ? await BlogModel.getStatus(did, this.user._id) : null;
        const udoc = await UserModel.getById(domainId, this.ddoc.owner);

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

    post() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    @param("did", Types.ObjectId)
    async postStar(_, did: ObjectId) {
        await BlogModel.setStar(did, this.user._id, true);
        this.back({ star: true });
    }

    @param("did", Types.ObjectId)
    async postUnstar(_, did: ObjectId) {
        await BlogModel.setStar(did, this.user._id, false);
        this.back({ star: false });
    }
}

class BlogCreateHandler extends Handler {
    get() {
        this.response.template = "blog_edit.html";
    }

    @param("title", Types.Title)
    @param("content", Types.Content)
    async postSubmit(_, title: string, content: string) {
        await this.limitRate("add_blog", 3600, 60);
        const did = await BlogModel.add(this.user._id, title, content, this.request.ip);
        this.response.body = { did };
        this.response.redirect = this.url(ROUTE_BLOG_DETAIL, { uid: this.user._id, did });
    }
}

class BlogEditHandler extends BlogBaseHandler {
    get() {
        this.response.template = "blog_edit.html";
        this.response.body = { ddoc: this.ddoc };
    }

    @param("did", Types.ObjectId)
    @param("title", Types.Title)
    @param("content", Types.Content)
    async postSubmit(_, did: ObjectId, title: string, content: string) {
        if (!this.user.own(this.ddoc)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await Promise.all([BlogModel.edit(did, title, content), OplogModel.log(this, "blog.edit", this.ddoc)]);
        this.response.body = { did };
        this.response.redirect = this.url(ROUTE_BLOG_DETAIL, { uid: this.user._id, did });
    }

    @param("did", Types.ObjectId)
    async postDelete(_, did: ObjectId) {
        if (!this.user.own(this.ddoc)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await Promise.all([BlogModel.del(did), OplogModel.log(this, "blog.delete", this.ddoc)]);
        this.response.redirect = this.url(ROUTE_BLOG_LIST_USER, { uid: this.ddoc.owner });
    }
}

export function applyHandler(ctx: Context) {
    ctx.Route(ROUTE_BLOG_LIST_USER, "/blog/:uid", BlogListUserHandler);
    ctx.Route(ROUTE_BLOG_DETAIL, "/blog/:uid/:did", BlogDetailHandler);
    ctx.Route(ROUTE_BLOG_CREATE, "/blog/:uid/create", BlogCreateHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route(ROUTE_BLOG_EDIT, "/blog/:uid/:did/edit", BlogEditHandler, PRIV.PRIV_USER_PROFILE);
}
