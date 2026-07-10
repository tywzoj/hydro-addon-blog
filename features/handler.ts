import type { Context, ObjectId } from "hydrooj";
import { DiscussionNotFoundError, Handler, OplogModel, param, PRIV, Types, UserModel } from "hydrooj";

import { BlogModel } from "./model";
import type { BlogDoc } from "./types";

export const ROUTE_BLOG_LIST_USER = "blog_list_user" as const;
export const ROUTE_BLOG_DETAIL = "blog_detail" as const;
export const ROUTE_BLOG_CREATE = "blog_create" as const;
export const ROUTE_BLOG_EDIT = "blog_edit" as const;

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
    ddoc!: BlogDoc; // ddoc will always be set in _prepare

    @param("did", Types.ObjectId)
    async _prepare(domainId: string, did: ObjectId) {
        const ddoc = await BlogModel.get(did);
        if (!ddoc) throw new DiscussionNotFoundError(domainId, did);
        this.ddoc = ddoc;
    }
}

class BlogDetailHandler extends BlogBaseHandler {
    async get(domainId: string) {
        const canTrackView = this.user.hasPriv(PRIV.PRIV_USER_PROFILE) && this.user._id > 0; // Only track views for logged-in users
        const dsdoc = canTrackView ? await BlogModel.getStatus(this.ddoc.docId, this.user._id) : null;
        const udoc = await UserModel.getById(domainId, this.ddoc.owner);

        if (canTrackView && !dsdoc?.view) {
            await Promise.all([
                BlogModel.inc(this.ddoc.docId, "views", 1),
                BlogModel.setStatus(this.ddoc.docId, this.user._id, { view: true }),
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

    async postStar() {
        await BlogModel.setStar(this.ddoc.docId, this.user._id, true);
        this.back({ star: true });
    }

    async postUnstar() {
        await BlogModel.setStar(this.ddoc.docId, this.user._id, false);
        this.back({ star: false });
    }
}

class BlogCreateHandler extends Handler {
    get() {
        this.response.template = "blog_edit.html";
        this.response.body = { ddoc: null };
    }

    @param("title", Types.Title)
    @param("content", Types.Content)
    @param("hidden", Types.Boolean, true)
    async postSubmit(_, title: string, content: string, hidden?: boolean) {
        await this.limitRate("add_blog", 3600, 60);
        const did = await BlogModel.add(this.user._id, title, content, hidden, this.request.ip);
        this.response.body = { did };
        this.response.redirect = this.url(ROUTE_BLOG_DETAIL, { uid: this.user._id, did });
    }
}

class BlogEditHandler extends BlogBaseHandler {
    get() {
        this.response.template = "blog_edit.html";
        this.response.body = { ddoc: this.ddoc };
    }

    @param("title", Types.Title)
    @param("content", Types.Content)
    @param("hidden", Types.Boolean, true)
    async postSubmit(_, title: string, content: string, hidden?: boolean) {
        if (!this.user.own(this.ddoc)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await Promise.all([
            BlogModel.edit(this.ddoc, title, content, hidden, this.request.ip),
            OplogModel.log(this, "blog.edit", this.ddoc),
        ]);
        this.response.body = { did: this.ddoc.docId };
        this.response.redirect = this.url(ROUTE_BLOG_DETAIL, { uid: this.user._id, did: this.ddoc.docId });
    }

    async postDelete() {
        if (!this.user.own(this.ddoc)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await Promise.all([BlogModel.del(this.ddoc.docId), OplogModel.log(this, "blog.delete", this.ddoc)]);
        this.response.redirect = this.url(ROUTE_BLOG_LIST_USER, { uid: this.ddoc.owner });
    }
}

export function applyHandler(ctx: Context) {
    ctx.Route(ROUTE_BLOG_LIST_USER, "/blog/:uid", BlogListUserHandler, PRIV.PRIV_USER_PROFILE);
    // The create must be placed before the detail route, otherwise it will be treated as a did parameter
    ctx.Route(ROUTE_BLOG_CREATE, "/blog/:uid/create", BlogCreateHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route(ROUTE_BLOG_DETAIL, "/blog/:uid/:did", BlogDetailHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route(ROUTE_BLOG_EDIT, "/blog/:uid/:did/edit", BlogEditHandler, PRIV.PRIV_USER_PROFILE);
}
