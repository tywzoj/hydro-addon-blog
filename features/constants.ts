export const SYSTEM_DOMAIN = "system" as const;

export const ROUTE_BLOG_LIST_HOME = "blog_list_home" as const;
export const ROUTE_BLOG_LIST_USER = "blog_list_user" as const;
export const ROUTE_BLOG_POST_DETAIL = "blog_post_detail" as const;
export const ROUTE_BLOG_POST_CREATE = "blog_post_create" as const;
export const ROUTE_BLOG_POST_EDIT = "blog_post_edit" as const;
export const ROUTE_BLOG_SETTINGS = "blog_settings" as const;
export const ROUTE_BLOG_SETTINGS_ROLES = "blog_settings_roles" as const;
export const ROUTE_BLOG_SETTINGS_PERMISSIONS = "blog_settings_permissions" as const;
export const ROUTE_BLOG_SETTINGS_USERS = "blog_settings_users" as const;

export const TEMPLATE_BLOG_LIST = "blog_main" as const;
export const TEMPLATE_BLOG_DETAIL = "blog_detail" as const;
export const TEMPLATE_BLOG_EDIT = "blog_edit" as const;
export const TEMPLATE_BLOG_SETTINGS = ROUTE_BLOG_SETTINGS;
export const TEMPLATE_BLOG_SETTINGS_ROLES = ROUTE_BLOG_SETTINGS_ROLES;
export const TEMPLATE_BLOG_SETTINGS_PERMISSIONS = ROUTE_BLOG_SETTINGS_PERMISSIONS;
export const TEMPLATE_BLOG_SETTINGS_USERS = ROUTE_BLOG_SETTINGS_USERS;

export const BLOG_SETTINGS_PAGES = [
    TEMPLATE_BLOG_SETTINGS,
    TEMPLATE_BLOG_SETTINGS_USERS,
    TEMPLATE_BLOG_SETTINGS_ROLES,
    TEMPLATE_BLOG_SETTINGS_PERMISSIONS,
] as const;

export const BlogRoles = {
    Guest: "guest",
    Default: "default",
    Root: "root",
} as const;
export type BuiltinBlogRole = (typeof BlogRoles)[keyof typeof BlogRoles];
export const BUILTIN_BLOG_ROLES: readonly string[] = Object.values(BlogRoles);

export const BlogCollections = {
    Settings: "blog.settings",
    UserRoles: "blog.user",
} as const;
export const BLOG_SETTINGS_ID = "global" as const;
export const BLOG_SETTINGS_VERSION = 1 as const;
export const BLOG_POSTS_PER_PAGE = 10;
export const BLOG_USERS_PER_PAGE = 20;
export const BLOG_FIRST_PAGE = 1;
export const ANONYMOUS_USER_ID = 0;
export const BLOG_PERMISSION_PLACEHOLDER = "1000" as const;
export const BLOG_CREATE_RATE_LIMIT = {
    Operation: "add_blog",
    PeriodSeconds: 3600,
    MaxOperations: 60,
} as const;

export const BlogActions = {
    ViewDraft: "VIEW_DRAFT",
    Create: "CREATE",
    Edit: "EDIT",
    Publish: "PUBLISH",
    Unpublish: "UNPUBLISH",
    Pin: "PIN",
    Delete: "DELETE",
} as const;
export type BlogAction = (typeof BlogActions)[keyof typeof BlogActions];

export const BlogOperations = {
    Submit: "submit",
    Star: "star",
    Pin: "pin",
    Publish: "publish",
    Delete: "delete",
    AddRole: "add",
    DeleteRoles: "delete_roles",
    AssignRole: "assign",
    SetUsers: "set_users",
} as const;
export type BlogOperation = (typeof BlogOperations)[keyof typeof BlogOperations];

export const BlogAuditEvents = {
    Create: "blog.create",
    Edit: "blog.edit",
    Delete: "blog.delete",
    CreateRole: "blog.role.create",
    DeleteRole: "blog.role.delete",
    AssignRole: "blog.role.assign",
    Permissions: "blog.permissions",
} as const;

export const BlogMessages = {
    Settings: "Blog settings",
    Articles: "Blog articles",
    YourRole: "Your blog role",
    GlobalScope: "Blog permissions apply across all domains.",
    PermissionScope: "Own and others permissions are separate. Access and authentication requirements still apply.",
    DefaultRoles: "Unassigned users use default. Anonymous users use guest. System editors always use root.",
    RoleLifecycle: "New roles copy default permissions. Deleting a role returns its users to default.",
    RoleList:
        "Blog permissions apply to all users without membership. This list only shows root and custom-role users.",
    AssignUserRoles: "Assign User Roles",
    ForcedRoot: "Forced by system privilege",
    ResetDefault: "Reset to default",
    DeleteRolesConfirm: "Delete selected roles? Their users will return to default.",
    Role: "Role",
    CreateRole: "Create Role",
    SetRole: "Set Role",
    SelectUsers: "Please select at least one user to perform this operation.",
    SelectRoles: "Please select at least one role to perform this operation.",
    RoleUpdated: "Role has been updated to {0}.",
    Publish: "Publish",
    Unpublish: "Unpublish",
    Unpin: "Unpin",
    SettingsChanged: "Blog settings changed. Reload and retry.",
    ArticleChanged: "The article changed. Reload and retry.",
    RoleExists: "Role already exists.",
    PermissionDenied: "You do not have the required blog permission: {0}.",
} as const;

export const BLOG_PERM = {
    ACCESS: 1n << 0n,
    VIEW_PUBLISHED: 1n << 1n,
    VIEW_DRAFT_OWN: 1n << 2n,
    VIEW_DRAFT_OTHERS: 1n << 3n,
    CREATE_OWN: 1n << 4n,
    CREATE_OTHERS: 1n << 5n,
    EDIT_OWN: 1n << 6n,
    EDIT_OTHERS: 1n << 7n,
    PUBLISH_OWN: 1n << 8n,
    PUBLISH_OTHERS: 1n << 9n,
    UNPUBLISH_OWN: 1n << 10n,
    UNPUBLISH_OTHERS: 1n << 11n,
    PIN_OWN: 1n << 12n,
    PIN_OTHERS: 1n << 13n,
    DELETE_OWN: 1n << 14n,
    DELETE_OTHERS: 1n << 15n,
    STAR: 1n << 16n,
    MANAGE_SETTINGS: 1n << 17n,
} as const;
export type BlogPermission = keyof typeof BLOG_PERM;
export const BlogPermissions = Object.fromEntries(Object.keys(BLOG_PERM).map((name) => [name, name])) as {
    [Name in BlogPermission]: Name;
};
export const BLOG_PERMISSION_LABELS = Object.fromEntries(
    Object.keys(BLOG_PERM).map((name) => [name, `blog_perm_${name}`]),
) as { [Name in BlogPermission]: `blog_perm_${Name}` };

export const BLOG_NONE = 0n;
export const BLOG_ALL = -1n;
export const BLOG_KNOWN = Object.values(BLOG_PERM).reduce((mask, bit) => mask | bit, BLOG_NONE);
export const BLOG_DEFAULT =
    BLOG_PERM.ACCESS |
    BLOG_PERM.VIEW_PUBLISHED |
    BLOG_PERM.VIEW_DRAFT_OWN |
    BLOG_PERM.CREATE_OWN |
    BLOG_PERM.EDIT_OWN |
    BLOG_PERM.PUBLISH_OWN |
    BLOG_PERM.UNPUBLISH_OWN |
    BLOG_PERM.PIN_OWN |
    BLOG_PERM.DELETE_OWN |
    BLOG_PERM.STAR;

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
