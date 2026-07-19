export const SYSTEM_DOMAIN = "system" as const;

export const ROUTE_BLOG_LIST_HOME = "blog_list_home" as const;
export const ROUTE_BLOG_LIST_USER = "blog_list_user" as const;
export const ROUTE_BLOG_POST_DETAIL = "blog_post_detail" as const;
export const ROUTE_BLOG_POST_CREATE = "blog_post_create" as const;
export const ROUTE_BLOG_POST_EDIT = "blog_post_edit" as const;

export const TEMPLATE_BLOG_LIST = "blog_main" as const;
export const TEMPLATE_BLOG_DETAIL = "blog_detail" as const;
export const TEMPLATE_BLOG_EDIT = "blog_edit" as const;

export const ListPageScenario = {
    Home: "home",
    User: "user",
} as const;
export type ListPageScenario = (typeof ListPageScenario)[keyof typeof ListPageScenario];

export const SortKeys = {
    LatestUpdate: "latest_update",
    Latest: "latest",
    Views: "views",
} as const;
export type SortKey = (typeof SortKeys)[keyof typeof SortKeys];
