import type { Context } from "hydrooj";

import {
    ROUTE_BLOG_LIST_HOME,
    ROUTE_BLOG_LIST_USER,
    SortKeys,
    TEMPLATE_BLOG_DETAIL,
    TEMPLATE_BLOG_EDIT,
    TEMPLATE_BLOG_LIST,
} from "./constants";

const USER_BLOG_TITLE = "{0}'s blog";
const BLOG_TITLE = "Blog";
const CREATE_POST = "Create a Post";
const UPDATED_AT = "Updated at: {0}";
const FIRST_PUBLISHED_AT = "First published at: {0}";
const PUBLISHED_AT = "Published at: {0}";
const NO_POST_YET = "No post yet...";
const VIEWS = "Views: {0}";

export function applyI18n(ctx: Context) {
    ctx.i18n.load("zh", {
        [USER_BLOG_TITLE]: "{0} 的博客",
        [BLOG_TITLE]: "博客",
        [CREATE_POST]: "创建文章",
        [UPDATED_AT]: "更新于: {0}",
        [FIRST_PUBLISHED_AT]: "首次发布于: {0}",
        [PUBLISHED_AT]: "发布于: {0}",
        [NO_POST_YET]: "尚无文章...",
        [VIEWS]: "浏览量: {0}",
        [ROUTE_BLOG_LIST_HOME]: "博客",
        [ROUTE_BLOG_LIST_USER]: "我的博客",
        [TEMPLATE_BLOG_DETAIL]: "博客详情",
        [TEMPLATE_BLOG_EDIT]: "编辑博客",
        [TEMPLATE_BLOG_LIST]: "博客",
        [`blog_sort_${SortKeys.Views}`]: "浏览最多",
        [`blog_sort_${SortKeys.Latest}`]: "最新发布",
        [`blog_sort_${SortKeys.LatestUpdate}`]: "最后更新",
    });
    ctx.i18n.load("zh_TW", {
        [USER_BLOG_TITLE]: "{0} 的部落格",
        [BLOG_TITLE]: "部落格",
        [CREATE_POST]: "建立文章",
        [UPDATED_AT]: "更新於: {0}",
        [FIRST_PUBLISHED_AT]: "首次發布於: {0}",
        [PUBLISHED_AT]: "發布於: {0}",
        [NO_POST_YET]: "尚無文章...",
        [VIEWS]: "瀏覽量: {0}",
        [ROUTE_BLOG_LIST_HOME]: "部落格",
        [ROUTE_BLOG_LIST_USER]: "我的部落格",
        [TEMPLATE_BLOG_DETAIL]: "部落格詳情",
        [TEMPLATE_BLOG_EDIT]: "編輯部落格",
        [TEMPLATE_BLOG_LIST]: "部落格",
        [`blog_sort_${SortKeys.Views}`]: "瀏覽最多",
        [`blog_sort_${SortKeys.Latest}`]: "最新發布",
        [`blog_sort_${SortKeys.LatestUpdate}`]: "最後更新",
    });
    ctx.i18n.load("kr", {
        [USER_BLOG_TITLE]: "{0}의 블로그",
        [BLOG_TITLE]: "블로그",
        [CREATE_POST]: "게시물 작성",
        [UPDATED_AT]: "업데이트: {0}",
        [FIRST_PUBLISHED_AT]: "최초 게시일: {0}",
        [PUBLISHED_AT]: "게시일: {0}",
        [NO_POST_YET]: "아직 게시물이 없습니다...",
        [VIEWS]: "조회수: {0}",
        [ROUTE_BLOG_LIST_HOME]: "블로그",
        [ROUTE_BLOG_LIST_USER]: "내 블로그",
        [TEMPLATE_BLOG_LIST]: "블로그",
        [TEMPLATE_BLOG_DETAIL]: "블로그 상세",
        [TEMPLATE_BLOG_EDIT]: "블로그 수정",
        [`blog_sort_${SortKeys.Views}`]: "조회수",
        [`blog_sort_${SortKeys.Latest}`]: "최초 게시일",
        [`blog_sort_${SortKeys.LatestUpdate}`]: "최근 업데이트",
    });
    ctx.i18n.load("en", {
        [ROUTE_BLOG_LIST_HOME]: "Blog",
        [ROUTE_BLOG_LIST_USER]: "My Blog",
        [TEMPLATE_BLOG_LIST]: "Blog",
        [TEMPLATE_BLOG_DETAIL]: "Blog Detail",
        [TEMPLATE_BLOG_EDIT]: "Edit Blog",
        [`blog_sort_${SortKeys.Views}`]: "Most Views",
        [`blog_sort_${SortKeys.Latest}`]: "Latest",
        [`blog_sort_${SortKeys.LatestUpdate}`]: "Latest Update",
    });
}
