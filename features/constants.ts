export const SYSTEM_DOMAIN = "system" as const;
export const TYPE_BLOG = 70 as const;
export const TYPE_BLOG_COMMENT = 71 as const;

export const ROUTE_BLOG_LIST_HOME = "blog_list_home" as const;
export const ROUTE_BLOG_LIST_USER = "blog_list_user" as const;
export const ROUTE_BLOG_POST_DETAIL = "blog_post_detail" as const;
export const ROUTE_BLOG_POST_CREATE = "blog_post_create" as const;
export const ROUTE_BLOG_POST_EDIT = "blog_post_edit" as const;
export const ROUTE_BLOG_SETTINGS = "blog_settings" as const;
export const ROUTE_BLOG_SETTINGS_ROLES = "blog_settings_roles" as const;
export const ROUTE_BLOG_SETTINGS_PERMISSIONS = "blog_settings_permissions" as const;
export const ROUTE_BLOG_SETTINGS_USERS = "blog_settings_users" as const;
export const ROUTE_BLOG_REVIEW = "blog_review" as const;
export const ROUTE_BLOG_REVIEW_DETAIL = "blog_review_detail" as const;
export const ROUTE_BLOG_REPORT = "blog_report" as const;
export const ROUTE_BLOG_REVIEW_RESET = "blog_review_reset" as const;

export const ReviewModes = { Disabled: "disabled", Before: "before", After: "after" } as const;
export type ReviewMode = (typeof ReviewModes)[keyof typeof ReviewModes];
export const ReviewReasons = { Publication: "publication", Report: "report" } as const;
export type ReviewReason = (typeof ReviewReasons)[keyof typeof ReviewReasons];
export const ReviewDecisions = { Approve: "approve", Reject: "reject" } as const;
export type ReviewDecision = (typeof ReviewDecisions)[keyof typeof ReviewDecisions];
export const BlogConfirmMessages = {
    Delete: "Delete this article and all its comments? This cannot be undone.",
    Publish: "Publish this article?",
    SubmitReview: "Submit this article for review? It will remain unpublished.",
    Unpublish: "Unpublish this article?",
    Withdraw: "Withdraw this article? It will be unpublished and any pending review will be cancelled.",
    UpdatePublished: "Save changes to this published article?",
    UpdateReviewed:
        "Save changes to this published article? Changed content will be unpublished and submitted for review.",
    DisableReview:
        "Disable article review? All currently pending articles, including reported articles, will be approved and published. Review counters will be reset and authors notified. This cannot be undone.",
    Approve: "Approve this article? It will be published and its review counters will be reset.",
    Reject: "Reject this article? It will be unpublished and its rejection count will increase.",
} as const;
export const DEFAULT_REVIEW_SETTINGS = {
    mode: ReviewModes.Disabled as ReviewMode,
    reportLimit: 3,
    rejectionLimit: 3,
    reminders: true,
    intervalMinutes: 1440,
    reminderRevision: 0,
};
export const REVIEW_PAGE_SIZE = 20;
export const REVIEW_BATCH_SIZE = 100;
export const REVIEW_DISABLE_ATTEMPTS = 3;
export const REVIEW_COMMENT_MAX = 65535;
export const REVIEW_MINUTE_MS = 60_000;
export const REVIEW_LEASE_MS = 5 * REVIEW_MINUTE_MS;
export const REVIEW_TASK = "blog.review.maintenance" as const;
export const REVIEW_RUNTIME_ID = "global" as const;
export const BLOG_REPORT_RATE_LIMIT = { Operation: "report_blog", PeriodSeconds: 3600, MaxOperations: 60 } as const;
export const ReviewMessages = {
    Title: "Blog review",
    Settings: "Article review",
    Mode: "Review mode",
    Disabled: "Review disabled",
    Submit: "Submit for review",
    DisableScope:
        "Disabling review approves all currently pending articles. Previously rejected articles outside the queue are unchanged.",
    Before: "Review before publication",
    After: "Review after publication",
    ReportLimit: "Hide when reports exceed",
    RejectionLimit: "Maximum review rejections",
    Reminders: "Enable reviewer reminders",
    Interval: "Summary interval (minutes)",
    ReminderScope: "Reviewer reminders do not affect author decision notifications.",
    Pending: "Pending review",
    Required: "Review required",
    Rejected: "Review rejected",
    Blocked: "Publication is blocked by the review rejection limit.",
    Unavailable: "This article cannot be reported.",
    AlreadyReported: "You already reported this version.",
    ReportAccepted: "Your report has been accepted.",
    Changed: "The review changed. Reload and retry.",
    Integrity: "The report could not be finalized. Retry later.",
    Approve: "Approve article",
    Reject: "Reject article",
    Reset: "Reset review counters",
    ResetConfirm: "Reset both counters? This does not publish or approve the article.",
    Withdraw: "Withdraw from review",
    Comments: "Review comments (optional)",
    ReportComments: "Report comments (optional)",
    Reports: "Reports",
    Rejections: "Rejections",
    Version: "Content version",
    Publication: "Publication review",
    Report: "Report review",
    Empty: "No articles awaiting review.",
    ApprovedNotice: 'Your blog article "{0}" (version {1}) was approved ({2:link}).',
    RejectedNotice: 'Your blog article "{0}" (version {1}) was rejected. {2} ({3:link}).',
    HiddenNotice: 'Your blog article "{0}" (version {1}) was unpublished after reports ({2:link}).',
    SummaryNotice: "There are {0} blog articles awaiting review ({1:link}).",
} as const;

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
    Reports: "blog.report",
    ReviewRuntime: "blog.review.runtime",
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
export const BLOG_COMMENT_RATE_LIMIT = {
    Operation: "add_blog_comment",
    PeriodSeconds: 3600,
    MaxOperations: 60,
} as const;
export const BLOG_COMMENT_NOTICE_LENGTH = 10;

export const BlogActions = {
    ViewDraft: "VIEW_DRAFT",
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
    Reply: "reply",
    TailReply: "tail_reply",
    DeleteReply: "delete_reply",
    DeleteTailReply: "delete_tail_reply",
    Like: "like",
    AddRole: "add",
    DeleteRoles: "delete_roles",
    AssignRole: "assign",
    SetUsers: "set_users",
    ReviewSettings: "review_settings",
    Report: "report",
    Decide: "decide",
    ResetReview: "reset_review",
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
    DeleteComment: "blog.reply.delete",
    DeleteTailReply: "blog.tailReply.delete",
    Review: "blog.review",
    Report: "blog.report",
    ResetReview: "blog.review.reset",
    ReviewSettings: "blog.review.settings",
} as const;

export const BlogMessages = {
    Settings: "Blog settings",
    Articles: "Blog articles",
    Comments: "Blog comments",
    CommentUnavailable: "The comment or article is no longer available.",
    CommentsPublishedOnly: "Comments and likes require a published article.",
    CommentScope:
        "Comment deletion follows discussion rules: article-owner moderation applies only to top-level comments.",
    LikeComment: "Like comment",
    UnlikeComment: "Unlike comment",
    CommentDeleted: '{0} {1} deleted your blog comment {2} in "{3}" ({4:link}).',
    TailReplyDeleted: 'Admin {0} deleted your blog reply {1} in "{2}" ({3:link}).',
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
    CREATE: 1n << 4n,
    EDIT_OWN: 1n << 5n,
    EDIT_OTHERS: 1n << 6n,
    PUBLISH_OWN: 1n << 7n,
    PUBLISH_OTHERS: 1n << 8n,
    UNPUBLISH_OWN: 1n << 9n,
    UNPUBLISH_OTHERS: 1n << 10n,
    PIN_OWN: 1n << 11n,
    PIN_OTHERS: 1n << 12n,
    DELETE_OWN: 1n << 13n,
    DELETE_OTHERS: 1n << 14n,
    STAR: 1n << 15n,
    MANAGE_SETTINGS: 1n << 16n,
    CREATE_COMMENT: 1n << 17n,
    DELETE_COMMENT_OWN: 1n << 18n,
    DELETE_COMMENT: 1n << 19n,
    DELETE_COMMENT_IN_OWN_POST: 1n << 20n,
    REVIEW: 1n << 21n,
    RESET_REVIEW_COUNTERS: 1n << 22n,
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
    BLOG_PERM.CREATE |
    BLOG_PERM.EDIT_OWN |
    BLOG_PERM.PUBLISH_OWN |
    BLOG_PERM.UNPUBLISH_OWN |
    BLOG_PERM.PIN_OWN |
    BLOG_PERM.DELETE_OWN |
    BLOG_PERM.STAR |
    BLOG_PERM.CREATE_COMMENT |
    BLOG_PERM.DELETE_COMMENT_OWN |
    BLOG_PERM.DELETE_COMMENT_IN_OWN_POST;

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
