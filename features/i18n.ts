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
const DRAFT = "Draft";

export function applyI18n(ctx: Context) {
    const labels: Record<string, [string, string, string, string]> = {
        blog_perm_ACCESS: ["Access blogs", "访问博客", "存取部落格", "블로그 접근"],
        blog_perm_VIEW_PUBLISHED: ["Read published articles", "阅读已发布文章", "閱讀已發布文章", "공개 게시물 읽기"],
        blog_perm_VIEW_DRAFT_OWN: ["Read own drafts", "阅读自己的草稿", "閱讀自己的草稿", "내 초안 읽기"],
        blog_perm_VIEW_DRAFT_OTHERS: [
            "Read others' drafts",
            "阅读他人的草稿",
            "閱讀他人的草稿",
            "다른 사용자의 초안 읽기",
        ],
        blog_perm_CREATE_OWN: ["Create own articles", "创建自己的文章", "建立自己的文章", "내 게시물 작성"],
        blog_perm_CREATE_OTHERS: [
            "Create articles for others",
            "为他人创建文章",
            "為他人建立文章",
            "다른 사용자의 게시물 작성",
        ],
        blog_perm_EDIT_OWN: ["Edit own articles", "编辑自己的文章", "編輯自己的文章", "내 게시물 수정"],
        blog_perm_EDIT_OTHERS: [
            "Edit others' articles",
            "编辑他人的文章",
            "編輯他人的文章",
            "다른 사용자의 게시물 수정",
        ],
        blog_perm_PUBLISH_OWN: [
            "Publish/update own public articles",
            "发布或更新自己的公开文章",
            "發布或更新自己的公開文章",
            "내 공개 게시물 게시 및 수정",
        ],
        blog_perm_PUBLISH_OTHERS: [
            "Publish/update others' public articles",
            "发布或更新他人的公开文章",
            "發布或更新他人的公開文章",
            "다른 사용자의 공개 게시물 게시 및 수정",
        ],
        blog_perm_UNPUBLISH_OWN: ["Unpublish own articles", "撤回自己的文章", "撤回自己的文章", "내 게시물 공개 취소"],
        blog_perm_UNPUBLISH_OTHERS: [
            "Unpublish others' articles",
            "撤回他人的文章",
            "撤回他人的文章",
            "다른 사용자의 게시물 공개 취소",
        ],
        blog_perm_PIN_OWN: [
            "Pin/unpin own articles",
            "置顶或取消置顶自己的文章",
            "置頂或取消置頂自己的文章",
            "내 게시물 고정 및 해제",
        ],
        blog_perm_PIN_OTHERS: [
            "Pin/unpin others' articles",
            "置顶或取消置顶他人的文章",
            "置頂或取消置頂他人的文章",
            "다른 사용자의 게시물 고정 및 해제",
        ],
        blog_perm_DELETE_OWN: ["Delete own articles", "删除自己的文章", "刪除自己的文章", "내 게시물 삭제"],
        blog_perm_DELETE_OTHERS: [
            "Delete others' articles",
            "删除他人的文章",
            "刪除他人的文章",
            "다른 사용자의 게시물 삭제",
        ],
        blog_perm_STAR: ["Star articles", "收藏文章", "收藏文章", "게시물 즐겨찾기"],
        blog_perm_MANAGE_SETTINGS: ["Manage blog settings", "管理博客设置", "管理部落格設定", "블로그 설정 관리"],
        "Blog settings": ["Blog settings", "博客设置", "部落格設定", "블로그 설정"],
        "Blog articles": ["Blog articles", "博客文章", "部落格文章", "블로그 게시물"],
        "Your blog role": ["Your blog role", "你的博客角色", "你的部落格角色", "내 블로그 역할"],
        "Blog permissions apply across all domains.": [
            "Blog permissions apply across all domains.",
            "博客权限在所有域中一致生效。",
            "部落格權限在所有域中一致生效。",
            "블로그 권한은 모든 도메인에 동일하게 적용됩니다.",
        ],
        "Own and others permissions are separate. Access and authentication requirements still apply.": [
            "Own and others permissions are separate. Access and authentication requirements still apply.",
            "自己与他人的权限独立控制；访问权限和登录验证要求仍然适用。",
            "自己與他人的權限獨立控制；存取權限和登入驗證要求仍然適用。",
            "본인과 다른 사용자의 권한은 별개이며 접근 권한과 인증이 필요합니다.",
        ],
        "Unassigned users use default. Anonymous users use guest. System editors always use root.": [
            "Unassigned users use default. Anonymous users use guest. System editors always use root.",
            "未分配用户使用 default，匿名用户使用 guest，系统编辑者始终使用 root。",
            "未分配使用者使用 default，匿名使用者使用 guest，系統編輯者始終使用 root。",
            "미지정 사용자는 default, 익명 사용자는 guest, 시스템 관리자는 항상 root입니다.",
        ],
        "New roles copy default permissions. Deleting a role returns its users to default.": [
            "New roles copy default permissions. Deleting a role returns its users to default.",
            "新角色复制 default 权限；删除角色后，其用户回到 default。",
            "新角色複製 default 權限；刪除角色後，其使用者回到 default。",
            "새 역할은 default 권한을 복사하며 역할 삭제 시 사용자는 default로 돌아갑니다.",
        ],
        "Only root and custom-role users are listed. Use the user selector to assign other users.": [
            "Only root and custom-role users are listed. Use the user selector to assign other users.",
            "仅列出 root 和自定义角色用户，可通过用户选择器为其他用户分配角色。",
            "僅列出 root 和自訂角色使用者，可透過使用者選擇器為其他使用者分配角色。",
            "root 및 사용자 지정 역할만 표시됩니다. 선택기로 다른 사용자에게 역할을 지정하세요.",
        ],
        "Forced by system privilege": [
            "Forced by system privilege",
            "由系统权限强制指定",
            "由系統權限強制指定",
            "시스템 권한으로 지정됨",
        ],
        "Reset to default": ["Reset to default", "恢复 default", "恢復 default", "default로 초기화"],
        "Set Role": ["Set Role", "设置角色", "設定角色", "역할 지정"],
        Publish: ["Publish", "发布", "發布", "게시"],
        Unpublish: ["Unpublish", "撤回发布", "撤回發布", "게시 취소"],
        Unpin: ["Unpin", "取消置顶", "取消置頂", "고정 해제"],
        "Blog settings changed. Reload and retry.": [
            "Blog settings changed. Reload and retry.",
            "博客设置已变更，请刷新后重试。",
            "部落格設定已變更，請重新整理後再試。",
            "설정이 변경되었습니다. 새로고침 후 다시 시도하세요.",
        ],
        "The article changed. Reload and retry.": [
            "The article changed. Reload and retry.",
            "文章已变更，请刷新后重试。",
            "文章已變更，請重新整理後再試。",
            "게시물이 변경되었습니다. 새로고침 후 다시 시도하세요.",
        ],
        "Role already exists.": ["Role already exists.", "角色已存在。", "角色已存在。", "역할이 이미 존재합니다."],
        "You do not have the required blog permission: {0}.": [
            "You do not have the required blog permission: {0}.",
            "你没有所需的博客权限：{0}。",
            "你沒有所需的部落格權限：{0}。",
            "필요한 블로그 권한이 없습니다: {0}.",
        ],
    };
    for (const [index, language] of ["en", "zh", "zh_TW", "ko"].entries()) {
        ctx.i18n.load(
            language,
            Object.fromEntries(Object.entries(labels).map(([key, values]) => [key, values[index]])),
        );
        ctx.i18n.load(language, {
            blog_settings: labels["Blog settings"][index],
            blog_settings_roles: labels["Blog settings"][index],
            blog_settings_permissions: labels["Blog settings"][index],
            blog_settings_users: labels["Blog settings"][index],
        });
    }
    ctx.i18n.load("zh", {
        [USER_BLOG_TITLE]: "{0} 的博客",
        [BLOG_TITLE]: "博客",
        [CREATE_POST]: "创建文章",
        [UPDATED_AT]: "更新于: {0}",
        [FIRST_PUBLISHED_AT]: "首次发布于: {0}",
        [PUBLISHED_AT]: "发布于: {0}",
        [NO_POST_YET]: "尚无文章...",
        [VIEWS]: "浏览量: {0}",
        [DRAFT]: "草稿",
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
        [DRAFT]: "草稿",
        [ROUTE_BLOG_LIST_HOME]: "部落格",
        [ROUTE_BLOG_LIST_USER]: "我的部落格",
        [TEMPLATE_BLOG_DETAIL]: "部落格詳情",
        [TEMPLATE_BLOG_EDIT]: "編輯部落格",
        [TEMPLATE_BLOG_LIST]: "部落格",
        [`blog_sort_${SortKeys.Views}`]: "瀏覽最多",
        [`blog_sort_${SortKeys.Latest}`]: "最新發布",
        [`blog_sort_${SortKeys.LatestUpdate}`]: "最後更新",
    });
    ctx.i18n.load("ko", {
        [USER_BLOG_TITLE]: "{0}의 블로그",
        [BLOG_TITLE]: "블로그",
        [CREATE_POST]: "게시물 작성",
        [UPDATED_AT]: "업데이트: {0}",
        [FIRST_PUBLISHED_AT]: "최초 게시일: {0}",
        [PUBLISHED_AT]: "게시일: {0}",
        [NO_POST_YET]: "아직 게시물이 없습니다...",
        [VIEWS]: "조회수: {0}",
        [DRAFT]: "임시 저장",
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
