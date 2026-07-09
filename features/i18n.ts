import type { Context } from "hydrooj";

import { ROUTE_BLOG_DETAIL, ROUTE_BLOG_EDIT, ROUTE_BLOG_LIST_USER } from "./handler";

export function applyI18n(ctx: Context) {
    ctx.i18n.load("zh", {
        "{0}'s blog": "{0} 的博客",
        Blog: "博客",
        [ROUTE_BLOG_DETAIL]: "博客详情",
        [ROUTE_BLOG_EDIT]: "编辑博客",
        [ROUTE_BLOG_LIST_USER]: "博客",
    });
    ctx.i18n.load("zh_TW", {
        "{0}'s blog": "{0} 的部落格",
        Blog: "部落格",
        [ROUTE_BLOG_DETAIL]: "部落格詳情",
        [ROUTE_BLOG_EDIT]: "編輯部落格",
        [ROUTE_BLOG_LIST_USER]: "部落格",
    });
    ctx.i18n.load("kr", {
        "{0}'s blog": "{0}의 블로그",
        Blog: "블로그",
        [ROUTE_BLOG_LIST_USER]: "블로그",
        [ROUTE_BLOG_DETAIL]: "블로그 상세",
        [ROUTE_BLOG_EDIT]: "블로그 수정",
    });
    ctx.i18n.load("en", {
        [ROUTE_BLOG_LIST_USER]: "Blog",
        [ROUTE_BLOG_DETAIL]: "Blog Detail",
        [ROUTE_BLOG_EDIT]: "Edit Blog",
    });
}
