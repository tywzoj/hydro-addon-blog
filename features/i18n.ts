import type { Context } from "hydrooj";

import { TEMPLATE_BLOG_DETAIL, TEMPLATE_BLOG_EDIT, TEMPLATE_BLOG_LIST } from "./handler";

export function applyI18n(ctx: Context) {
    ctx.i18n.load("zh", {
        "{0}'s blog": "{0} 的博客",
        Blog: "博客",
        [TEMPLATE_BLOG_DETAIL]: "博客详情",
        [TEMPLATE_BLOG_EDIT]: "编辑博客",
        [TEMPLATE_BLOG_LIST]: "博客",
    });
    ctx.i18n.load("zh_TW", {
        "{0}'s blog": "{0} 的部落格",
        Blog: "部落格",
        [TEMPLATE_BLOG_DETAIL]: "部落格詳情",
        [TEMPLATE_BLOG_EDIT]: "編輯部落格",
        [TEMPLATE_BLOG_LIST]: "部落格",
    });
    ctx.i18n.load("kr", {
        "{0}'s blog": "{0}의 블로그",
        Blog: "블로그",
        [TEMPLATE_BLOG_LIST]: "블로그",
        [TEMPLATE_BLOG_DETAIL]: "블로그 상세",
        [TEMPLATE_BLOG_EDIT]: "블로그 수정",
    });
    ctx.i18n.load("en", {
        [TEMPLATE_BLOG_LIST]: "Blog",
        [TEMPLATE_BLOG_DETAIL]: "Blog Detail",
        [TEMPLATE_BLOG_EDIT]: "Edit Blog",
    });
}
