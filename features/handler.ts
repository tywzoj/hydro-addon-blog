import type { Context, Filter, ObjectId } from "hydrooj";
import { DiscussionNotFoundError, Handler, OplogModel, param, PRIV, Types, UserModel } from "hydrooj";

import { BlogModel } from "./model";
import type { BlogDoc } from "./types";
import { toTemplate } from "./utils";

export const ROUTE_BLOG_LIST_USER = "blog_list_user" as const;
export const ROUTE_BLOG_POST_DETAIL = "blog_post_detail" as const;
export const ROUTE_BLOG_POST_CREATE = "blog_post_create" as const;
export const ROUTE_BLOG_POST_EDIT = "blog_post_edit" as const;

export const TEMPLATE_BLOG_LIST = "blog_list" as const;
export const TEMPLATE_BLOG_DETAIL = "blog_detail" as const;
export const TEMPLATE_BLOG_EDIT = "blog_edit" as const;

class BlogListUserHandler extends Handler {
    @param("uid", Types.Int)
    @param("page", Types.PositiveInt, true)
    async get(domainId: string, uid: number, page = 1) {
        const query: Filter<BlogDoc> = { owner: uid };

        if (!this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && this.user._id !== uid) {
            query.hidden = false;
        }

        const [ddocs, dpcount] = await this.ctx.db.paginate(BlogModel.getMulti(query), page, 10);
        const udoc = await UserModel.getById(domainId, uid);
        this.response.template = toTemplate(TEMPLATE_BLOG_LIST);
        this.response.body = {
            ddocs,
            dpcount,
            udoc,
            page,
        };
    }
}

class BlogPostBaseHandler extends Handler {
    ddoc!: BlogDoc; // ddoc will always be set in _prepare

    @param("did", Types.ObjectId)
    async _prepare(domainId: string, did: ObjectId) {
        const ddoc = await BlogModel.get(did);
        if (!ddoc) throw new DiscussionNotFoundError(domainId, did);
        this.ddoc = ddoc;
    }
}

class BlogPostDetailHandler extends BlogPostBaseHandler {
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

        this.response.template = toTemplate(TEMPLATE_BLOG_DETAIL);
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

class BlogPostCreateHandler extends Handler {
    get() {
        this.response.template = toTemplate(TEMPLATE_BLOG_EDIT);
        this.response.body = { ddoc: null };
    }

    @param("title", Types.Title)
    @param("content", Types.Content)
    @param("hidden", Types.Boolean, true)
    async postSubmit(_, title: string, content: string, hidden?: boolean) {
        await this.limitRate("add_blog", 3600, 60);
        const did = await BlogModel.add(this.user._id, title, content, hidden, this.request.ip);
        this.response.body = { did };
        this.response.redirect = this.url(ROUTE_BLOG_POST_DETAIL, { uid: this.user._id, did });
    }
}

class BlogPostEditHandler extends BlogPostBaseHandler {
    get() {
        this.response.template = toTemplate(TEMPLATE_BLOG_EDIT);
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
        this.response.redirect = this.url(ROUTE_BLOG_POST_DETAIL, { uid: this.user._id, did: this.ddoc.docId });
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
    ctx.Route(ROUTE_BLOG_POST_CREATE, "/blog/:uid/create", BlogPostCreateHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route(ROUTE_BLOG_POST_DETAIL, "/blog/:uid/:did", BlogPostDetailHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route(ROUTE_BLOG_POST_EDIT, "/blog/:uid/:did/edit", BlogPostEditHandler, PRIV.PRIV_USER_PROFILE);
}
