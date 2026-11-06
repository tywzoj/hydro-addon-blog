import type { Context, Filter } from "hydrooj";
import { OplogModel, param, Types, UserModel } from "hydrooj";
import type { SortDirection } from "mongodb";

import { BlogCommentHandler } from "./comments.handler";
import type { SortKey } from "./constants";
import {
    BLOG_CREATE_RATE_LIMIT,
    BLOG_FIRST_PAGE,
    BLOG_POSTS_PER_PAGE,
    BlogActions,
    BlogAuditEvents,
    BlogPermissions,
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
import { BlogBaseHandler, BlogUserBaseHandler, BlogUserPostBaseHandler } from "./handler.base";
import { BlogModel } from "./model";
import type { BlogContentUpdate, BlogDoc } from "./types";
import { toTemplate } from "./utils";

// Convert JSON false/0 without treating omitted fields as explicit false.
const OptionalBoolean = [
    (value: unknown) => (value === undefined || value === null || value === "" ? undefined : Types.Boolean[0](value)),
    Types.Boolean[1],
    "convert",
] as const;

export const SortKeyMap: Record<SortKey, Partial<Record<keyof BlogDoc, SortDirection>>> = {
    [SortKeys.Views]: { views: -1 },
    [SortKeys.Latest]: { firstPublishAt: -1 },
    [SortKeys.LatestUpdate]: { updateAt: -1 },
};

class BlogListHandler extends BlogBaseHandler {
    @param("page", Types.PositiveInt, true)
    @param("sort", Types.Range([SortKeys.Views, SortKeys.Latest, SortKeys.LatestUpdate]), true)
    async get(_, page = BLOG_FIRST_PAGE, sort: SortKey = SortKeys.Latest) {
        this.blog.require(BlogPermissions.VIEW_PUBLISHED);
        const [ddocs, dpcount] = await this.ctx.db.paginate(
            BlogModel.getMulti({
                draft: { $ne: true },
            }).sort(SortKeyMap[sort]),
            page,
            BLOG_POSTS_PER_PAGE,
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
            udoc: this.user,
            udict,
            can_create: this.blog.canCreate(this.user._id),
            can_settings: this.blog.has(BlogPermissions.MANAGE_SETTINGS),
        };
    }
}

class BlogListUserHandler extends BlogUserBaseHandler {
    @param("page", Types.PositiveInt, true)
    @param("sort", Types.Range([SortKeys.Views, SortKeys.Latest, SortKeys.LatestUpdate]), true)
    async get(_, page = BLOG_FIRST_PAGE, sort?: SortKey) {
        const isOwner = this.user._id === this.udoc._id;
        const query: Filter<BlogDoc> = { owner: this.udoc._id };

        const drafts = this.blog.can(BlogActions.ViewDraft, this.udoc._id);
        if (!drafts) {
            this.blog.require(BlogPermissions.VIEW_PUBLISHED);
            query.draft = { $ne: true };
            sort ??= SortKeys.Latest;
        } else {
            if (!this.blog.has(BlogPermissions.VIEW_PUBLISHED)) query.draft = true;
            sort ??= SortKeys.LatestUpdate;
        }

        const [ddocs, dpcount] = await this.ctx.db.paginate(
            BlogModel.getMulti(query).sort({
                pin: -1,
                ...SortKeyMap[sort],
            }),
            page,
            BLOG_POSTS_PER_PAGE,
        );
        this.response.template = toTemplate(TEMPLATE_BLOG_LIST);
        this.response.body = {
            scenario: ListPageScenario.User,
            ddocs,
            dpcount,
            page,
            sort,
            sort_keys: Object.values(SortKeys),
            is_owner: isOwner,
            udoc: this.udoc,
            can_create: this.blog.canCreate(this.udoc._id),
            can_settings: this.blog.has(BlogPermissions.MANAGE_SETTINGS),
        };
    }
}

class BlogUserPostDetailHandler extends BlogCommentHandler {
    @param("page", Types.PositiveInt, true)
    async get(_, page = BLOG_FIRST_PAGE) {
        this.requireRead();
        const comments = await this.loadComments(page);
        const canTrackView = this.blog.authenticated;
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
            controls: this.blog.controls(this.ddoc),
            ...comments,
        };
    }

    post() {
        this.requireRead();
        this.blog.requireLogin();
    }

    @param("star", Types.Boolean, false)
    async postStar(_, star: boolean) {
        this.post();
        this.blog.require(BlogPermissions.STAR);
        await BlogModel.setStar(this.ddoc.docId, this.user._id, star);
        this.back({ star });
    }
}

class BlogUserPostCreateHandler extends BlogUserBaseHandler {
    prepare() {
        this.blog.requireCreate(this.udoc._id);
    }

    get() {
        this.response.template = toTemplate(TEMPLATE_BLOG_EDIT);
        this.response.body = {
            ddoc: null,
            controls: {
                publish: this.blog.can(BlogActions.Publish, this.udoc._id),
                pin: this.blog.can(BlogActions.Pin, this.udoc._id),
            },
        };
    }

    @param("title", Types.Title)
    @param("content", Types.Content)
    @param("draft", OptionalBoolean)
    @param("pin", OptionalBoolean)
    @param("draft_present", Types.Boolean, true)
    async postSubmit(_, title: string, content: string, draft?: boolean, pin = false, draftPresent = false) {
        draft ??= !draftPresent;
        this.prepare();
        if (!draft) this.blog.requireAction(BlogActions.Publish, this.udoc._id);
        if (pin) this.blog.requireAction(BlogActions.Pin, this.udoc._id);
        await this.limitRate(
            BLOG_CREATE_RATE_LIMIT.Operation,
            BLOG_CREATE_RATE_LIMIT.PeriodSeconds,
            BLOG_CREATE_RATE_LIMIT.MaxOperations,
        );
        const did = await BlogModel.add(this.user._id, title, content, draft, pin, this.request.ip);
        await OplogModel.log(this, BlogAuditEvents.Create, { did });
        this.response.body = { did };
        this.response.redirect = this.url(
            this.blog.readable({ owner: this.udoc._id, draft }) ? ROUTE_BLOG_POST_DETAIL : ROUTE_BLOG_LIST_USER,
            { uid: this.udoc._id, did },
        );
    }
}

class BlogUserPostEditHandler extends BlogUserPostBaseHandler {
    prepare() {
        this.blog.requireLogin();
        this.requireRead();
    }

    get() {
        this.blog.requireAction(BlogActions.Edit, this.ddoc.owner);
        this.response.template = toTemplate(TEMPLATE_BLOG_EDIT);
        this.response.body = { ddoc: this.ddoc, controls: this.blog.controls(this.ddoc) };
    }

    @param("title", Types.Title)
    @param("content", Types.Content)
    @param("draft", OptionalBoolean)
    @param("pin", OptionalBoolean)
    @param("draft_present", Types.Boolean, true)
    @param("pin_present", Types.Boolean, true)
    async postSubmit(
        _,
        title: string,
        content: string,
        draft?: boolean,
        pin?: boolean,
        draftPresent = false,
        pinPresent = false,
    ) {
        draft ??= draftPresent ? false : !!this.ddoc.draft;
        pin ??= pinPresent ? false : !!this.ddoc.pin;
        this.prepare();
        const changedContent = title !== this.ddoc.title || content !== this.ddoc.content;
        if (changedContent) this.blog.requireAction(BlogActions.Edit, this.ddoc.owner);
        if (!draft && (changedContent || this.ddoc.draft)) {
            this.blog.requireAction(BlogActions.Publish, this.ddoc.owner);
        }
        if (draft && !this.ddoc.draft) this.blog.requireAction(BlogActions.Unpublish, this.ddoc.owner);
        if (pin !== !!this.ddoc.pin) this.blog.requireAction(BlogActions.Pin, this.ddoc.owner);
        if (!changedContent && draft === !!this.ddoc.draft && pin === !!this.ddoc.pin) {
            this.response.redirect = this.url(ROUTE_BLOG_POST_DETAIL, { uid: this.udoc._id, did: this.ddoc.docId });
            return;
        }
        await this.update({ title, content, draft, pin });
    }

    async update(update: BlogContentUpdate) {
        const next = await BlogModel.edit(this.ddoc, { ...update, ip: this.request.ip }, true);
        await OplogModel.log(this, BlogAuditEvents.Edit, this.ddoc);
        this.response.body = { did: this.ddoc.docId };
        this.response.redirect = this.url(this.blog.readable(next) ? ROUTE_BLOG_POST_DETAIL : ROUTE_BLOG_LIST_USER, {
            uid: this.udoc._id,
            did: this.ddoc.docId,
        });
    }

    @param("pin", Types.Boolean, false)
    async postPin(_, pin: boolean) {
        this.prepare();
        this.blog.requireAction(BlogActions.Pin, this.ddoc.owner);
        await this.update({ pin });
    }

    @param("draft", Types.Boolean, false)
    async postPublish(_, draft: boolean) {
        this.prepare();
        this.blog.requireAction(draft ? BlogActions.Unpublish : BlogActions.Publish, this.ddoc.owner);
        await this.update({ draft });
    }

    async postDelete() {
        this.prepare();
        this.blog.requireAction(BlogActions.Delete, this.ddoc.owner);
        await BlogModel.deleteChecked(this.ddoc);
        await OplogModel.log(this, BlogAuditEvents.Delete, this.ddoc);
        this.response.redirect = this.url(ROUTE_BLOG_LIST_USER, { uid: this.ddoc.owner });
    }
}

export function applyHandler(ctx: Context) {
    ctx.Route(ROUTE_BLOG_LIST_HOME, "/blog", BlogListHandler);
    ctx.Route(ROUTE_BLOG_LIST_USER, "/blog/:uid", BlogListUserHandler);
    // The create must be placed before the detail route, otherwise it will be treated as a did parameter
    ctx.Route(ROUTE_BLOG_POST_CREATE, "/blog/:uid/create", BlogUserPostCreateHandler);
    ctx.Route(ROUTE_BLOG_POST_DETAIL, "/blog/:uid/:did", BlogUserPostDetailHandler);
    ctx.Route(ROUTE_BLOG_POST_EDIT, "/blog/:uid/:did/edit", BlogUserPostEditHandler);
}
