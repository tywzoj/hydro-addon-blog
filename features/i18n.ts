import type { Context } from "hydrooj";

import { SortKeys, TEMPLATE_BLOG_DETAIL, TEMPLATE_BLOG_EDIT, TEMPLATE_BLOG_LIST } from "./handler";

export function applyI18n(ctx: Context) {
    ctx.i18n.load("zh", {
        "{0}'s blog": "{0} 的博客",
        Blog: "博客",
        "Create a Post": "创建博客",
        "Updated at: {0}": "更新于: {0}",
        "First published at: {0}": "首次发布于: {0}",
        [TEMPLATE_BLOG_DETAIL]: "博客详情",
        [TEMPLATE_BLOG_EDIT]: "编辑博客",
        [TEMPLATE_BLOG_LIST]: "博客",
        [`blog_sort_${SortKeys.Views}`]: "浏览最多",
        [`blog_sort_${SortKeys.Latest}`]: "最新发布",
        [`blog_sort_${SortKeys.LatestUpdate}`]: "最后更新",
    });
    ctx.i18n.load("zh_TW", {
        "{0}'s blog": "{0} 的部落格",
        Blog: "部落格",
        "Create a Post": "建立文章",
        "Updated at: {0}": "更新於: {0}",
        "First published at: {0}": "首次發布於: {0}",
        [TEMPLATE_BLOG_DETAIL]: "部落格詳情",
        [TEMPLATE_BLOG_EDIT]: "編輯部落格",
        [TEMPLATE_BLOG_LIST]: "部落格",
        [`blog_sort_${SortKeys.Views}`]: "瀏覽最多",
        [`blog_sort_${SortKeys.Latest}`]: "最新發布",
        [`blog_sort_${SortKeys.LatestUpdate}`]: "最後更新",
    });
    ctx.i18n.load("kr", {
        "{0}'s blog": "{0}의 블로그",
        Blog: "블로그",
        "Create a Post": "게시물 작성",
        "Updated at: {0}": "업데이트: {0}",
        "First published at: {0}": "최초 게시일: {0}",
        [TEMPLATE_BLOG_LIST]: "블로그",
        [TEMPLATE_BLOG_DETAIL]: "블로그 상세",
        [TEMPLATE_BLOG_EDIT]: "블로그 수정",
        [`blog_sort_${SortKeys.Views}`]: "조회수",
        [`blog_sort_${SortKeys.Latest}`]: "최초 게시일",
        [`blog_sort_${SortKeys.LatestUpdate}`]: "최근 업데이트",
    });
    ctx.i18n.load("en", {
        [TEMPLATE_BLOG_LIST]: "Blog",
        [TEMPLATE_BLOG_DETAIL]: "Blog Detail",
        [TEMPLATE_BLOG_EDIT]: "Edit Blog",
        [`blog_sort_${SortKeys.Views}`]: "Most Views",
        [`blog_sort_${SortKeys.Latest}`]: "Latest",
        [`blog_sort_${SortKeys.LatestUpdate}`]: "Latest Update",
    });
}
