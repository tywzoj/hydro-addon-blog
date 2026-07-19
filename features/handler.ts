import type { Context, Filter, ObjectId } from "hydrooj";
import { DiscussionNotFoundError, Handler, OplogModel, param, PRIV, Types, UserModel } from "hydrooj";
import type { SortDirection } from "mongodb";

import type { SortKey } from "./constants";
import {
    ListPageScenario,
    ROUTE_BLOG_LIST_HOME,
    ROUTE_BLOG_LIST_USER,
    ROUTE_BLOG_POST_CREATE,
    ROUTE_BLOG_POST_DETAIL,
    ROUTE_BLOG_POST_EDIT,
    SortKeys,
    SYSTEM_DOMAIN,
    TEMPLATE_BLOG_DETAIL,
    TEMPLATE_BLOG_EDIT,
    TEMPLATE_BLOG_LIST,
} from "./constants";
import { BlogModel } from "./model";
import type { BlogDoc } from "./types";
import { toTemplate } from "./utils";

export const SortKeyMap: Record<SortKey, Partial<Record<keyof BlogDoc, SortDirection>>> = {
    [SortKeys.Views]: { views: -1 },
    [SortKeys.Latest]: { firstPublishAt: -1 },
    [SortKeys.LatestUpdate]: { updateAt: -1 },
};

class BlogListHomeHandler extends Handler {
    @param("page", Types.PositiveInt, true)
    @param("sort", Types.Range([SortKeys.Views, SortKeys.Latest, SortKeys.LatestUpdate]), true)
    async get(_, page = 1, sort: SortKey = SortKeys.Latest) {
        const [ddocs, dpcount] = await this.ctx.db.paginate(
            BlogModel.getMulti({
                hidden: { $ne: true },
            }).sort(SortKeyMap[sort]),
            page,
            10,
        );

        const udict = await UserModel.getList(
            SYSTEM_DOMAIN,
            ddocs.map((doc) => doc.owner),
        );

        this.response.template = toTemplate(TEMPLATE_BLOG_LIST);
        this.response.body = {
            scenario: ListPageScenario.Home,
            ddocs,
            dpcount,
            page,
            sort,
            sort_keys: Object.values(SortKeys),
            is_owner: false, // Home page does not have a specific owner
            udoc: null, // Home page does not have a specific user document
            udict,
        };
    }
}

class BlogListUserHandler extends Handler {
    @param("uid", Types.Int)
    @param("page", Types.PositiveInt, true)
    @param("sort", Types.Range([SortKeys.Views, SortKeys.Latest, SortKeys.LatestUpdate]), true)
    async get(_, uid: number, page = 1, sort?: SortKey) {
        const isOwner = this.user._id === uid;
        const query: Filter<BlogDoc> = { owner: uid };

        // If the user is not the owner and does not have the edit system privilege, only show non-hidden blogs.
        // If user is not the owner and the sort is default, sort it by the first publish time, otherwise sort it by the update time.
        if (!this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && !isOwner) {
            query.hidden = { $ne: true };
            sort ??= SortKeys.Latest;
        } else {
            sort ??= SortKeys.LatestUpdate;
        }

        const [ddocs, dpcount] = await this.ctx.db.paginate(
            BlogModel.getMulti(query).sort({
                pin: -1,
                ...SortKeyMap[sort],
            }),
            page,
            10,
        );
        const udoc = await UserModel.getById(SYSTEM_DOMAIN, uid);
        this.response.template = toTemplate(TEMPLATE_BLOG_LIST);
        this.response.body = {
            scenario: ListPageScenario.User,
            ddocs,
            dpcount,
            page,
            sort,
            sort_keys: Object.values(SortKeys),
            is_owner: isOwner,
            udoc,
            uidict: null, // User page does not have a specific user dictionary
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
    async get() {
        const canTrackView = this.user.hasPriv(PRIV.PRIV_USER_PROFILE) && this.user._id > 0; // Only track views for logged-in users
        const dsdoc = canTrackView ? await BlogModel.getStatus(this.ddoc.docId, this.user._id) : null;
        const udoc = await UserModel.getById(SYSTEM_DOMAIN, this.ddoc.owner);

        if (canTrackView && !dsdoc?.view) {
            await Promise.all([
                BlogModel.inc(this.ddoc.docId, "views", 1),
                BlogModel.setStatus(this.ddoc.docId, this.user._id, { view: true }),
            ]);
            this.ddoc.views++; // Increment the view count in the ddoc to reflect the change
        }

        this.response.template = toTemplate(TEMPLATE_BLOG_DETAIL);
        this.response.body = {
            ddoc: this.ddoc,
            dsdoc,
            udoc,
            star: dsdoc?.star ?? false,
        };
    }

    post() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    @param("star", Types.Boolean)
    async postStar(_, star: boolean) {
        await BlogModel.setStar(this.ddoc.docId, this.user._id, star);
        this.back({ star });
    }
}

class BlogPostCreateHandler extends Handler {
    get() {
        this.response.template = toTemplate(TEMPLATE_BLOG_EDIT);
        this.response.body = { ddoc: null };
    }

    @param("title", Types.Title)
    @param("content", Types.Content)
    @param("hidden", Types.Boolean)
    @param("pin", Types.Boolean)
    async postSubmit(_, title: string, content: string, hidden = false, pin = false) {
        await this.limitRate("add_blog", 3600, 60);
        const did = await BlogModel.add(this.user._id, title, content, hidden, pin, this.request.ip);
        await OplogModel.log(this, "blog.create", { did });
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
    @param("hidden", Types.Boolean)
    @param("pin", Types.Boolean)
    async postSubmit(_, title: string, content: string, hidden = false, pin = false) {
        if (!this.user.own(this.ddoc)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await Promise.all([
            BlogModel.edit(this.ddoc, {
                title,
                content,
                hidden,
                pin,
                ip: this.request.ip,
            }),
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
    ctx.Route(ROUTE_BLOG_LIST_HOME, "/blog", BlogListHomeHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route(ROUTE_BLOG_LIST_USER, "/blog/:uid", BlogListUserHandler, PRIV.PRIV_USER_PROFILE);
    // The create must be placed before the detail route, otherwise it will be treated as a did parameter
    ctx.Route(ROUTE_BLOG_POST_CREATE, "/blog/:uid/create", BlogPostCreateHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route(ROUTE_BLOG_POST_DETAIL, "/blog/:uid/:did", BlogPostDetailHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route(ROUTE_BLOG_POST_EDIT, "/blog/:uid/:did/edit", BlogPostEditHandler, PRIV.PRIV_USER_PROFILE);
}
