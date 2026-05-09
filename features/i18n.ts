import type { Context } from "hydrooj";

export function applyI18n(ctx: Context) {
    ctx.i18n.load("zh", {
        "{0}'s blog": "{0} 的博客",
        Blog: "博客",
        blog_detail: "博客详情",
        blog_edit: "编辑博客",
        blog_main: "博客",
    });
    ctx.i18n.load("zh_TW", {
        "{0}'s blog": "{0} 的部落格",
        Blog: "部落格",
        blog_detail: "部落格詳情",
        blog_edit: "編輯部落格",
        blog_main: "部落格",
    });
    ctx.i18n.load("kr", {
        "{0}'s blog": "{0}의 블로그",
        Blog: "블로그",
        blog_main: "블로그",
        blog_detail: "블로그 상세",
        blog_edit: "블로그 수정",
    });
    ctx.i18n.load("en", {
        blog_main: "Blog",
        blog_detail: "Blog Detail",
        blog_edit: "Edit Blog",
    });
}
