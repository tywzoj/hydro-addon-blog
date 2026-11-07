import type { Context } from "hydrooj";

import {
    BLOG_PERMISSION_LABELS,
    BLOG_SETTINGS_PAGES,
    BlogConfirmMessages,
    BlogMessages,
    ReviewMessages,
    ROUTE_BLOG_LIST_HOME,
    ROUTE_BLOG_LIST_USER,
    ROUTE_BLOG_REVIEW,
    ROUTE_BLOG_REVIEW_DETAIL,
    ROUTE_BLOG_REVIEW_RESET,
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
const reviewLabels: Record<string, [string, string, string]> = {
    "Article actions": ["文章操作", "文章操作", "게시물 작업"],
    "Review comments": ["审查意见", "審查意見", "심사 의견"],
    Reporter: ["举报人", "檢舉人", "신고자"],
    [BlogConfirmMessages.Delete]: [
        "确认删除这篇文章及其全部评论？此操作无法撤销。",
        "確定刪除這篇文章及其全部評論？此操作無法復原。",
        "이 게시물과 모든 댓글을 삭제할까요? 이 작업은 되돌릴 수 없습니다.",
    ],
    [BlogConfirmMessages.Publish]: ["确认发布这篇文章？", "確定發布這篇文章？", "이 게시물을 게시할까요?"],
    [BlogConfirmMessages.SubmitReview]: [
        "确认提交这篇文章进行审查？通过前文章不会发布。",
        "確定提交這篇文章進行審查？通過前文章不會發布。",
        "이 게시물을 심사에 제출할까요? 승인 전에는 공개되지 않습니다.",
    ],
    [BlogConfirmMessages.Unpublish]: [
        "确认撤回发布这篇文章？",
        "確定撤回發布這篇文章？",
        "이 게시물을 비공개로 전환할까요?",
    ],
    [BlogConfirmMessages.Withdraw]: [
        "确认撤回这篇文章？文章将变为未发布，待处理的审查也会取消。",
        "確定撤回這篇文章？文章將變為未發布，待處理的審查也會取消。",
        "이 게시물을 철회할까요? 비공개로 전환되고 대기 중인 심사가 취소됩니다.",
    ],
    [BlogConfirmMessages.UpdatePublished]: [
        "确认保存对已发布文章的修改？",
        "確定儲存對已發布文章的修改？",
        "게시된 글의 변경 사항을 저장할까요?",
    ],
    [BlogConfirmMessages.UpdateReviewed]: [
        "确认保存对已发布文章的修改？修改内容后文章将下架并提交审查。",
        "確定儲存對已發布文章的修改？修改內容後文章將下架並提交審查。",
        "게시된 글의 변경 사항을 저장할까요? 내용을 수정하면 비공개로 전환되고 심사에 제출됩니다.",
    ],
    [BlogConfirmMessages.DisableReview]: [
        "确认关闭文章审查？当前所有待审文章（包括被举报的文章）都将通过审查并发布，审查计数将清零，并通知作者。此操作无法撤销。",
        "確定關閉文章審查？目前所有待審文章（包括被檢舉的文章）都將通過審查並發布，審查計數將清零，並通知作者。此操作無法復原。",
        "게시물 심사를 끌까요? 신고된 글을 포함한 모든 심사 대기 게시물이 승인되어 공개됩니다. 심사 횟수가 초기화되고 작성자에게 알림이 전송됩니다. 이 작업은 되돌릴 수 없습니다.",
    ],
    [BlogConfirmMessages.Approve]: [
        "确认通过文章审查？文章将发布，审查计数也会清零。",
        "確定通過文章審查？文章將發布，審查計數也會清零。",
        "이 게시물을 승인할까요? 게시물이 공개되고 심사 횟수가 초기화됩니다.",
    ],
    [BlogConfirmMessages.Reject]: [
        "确认拒绝这篇文章？文章将变为未发布，拒绝次数会增加。",
        "確定拒絕這篇文章？文章將變為未發布，拒絕次數會增加。",
        "이 게시물을 거부할까요? 비공개로 전환되고 거부 횟수가 증가합니다.",
    ],
    [ReviewMessages.Title]: ["博客审查", "部落格審查", "블로그 심사"],
    [ReviewMessages.Settings]: ["文章审查", "文章審查", "게시물 심사"],
    [ReviewMessages.Mode]: ["审查模式", "審查模式", "심사 방식"],
    [ReviewMessages.Disabled]: ["关闭审查", "關閉審查", "심사 사용 안 함"],
    [ReviewMessages.Submit]: ["提交审查", "提交審查", "심사에 제출"],
    [ReviewMessages.DisableScope]: [
        "关闭审查会通过当前所有待审文章。不在待审队列中的已拒绝文章不受影响。",
        "關閉審查會通過目前所有待審文章。不在待審佇列中的已拒絕文章不受影響。",
        "심사를 끄면 현재 대기 중인 모든 게시물이 승인됩니다. 대기열에 없는 거부된 게시물은 변경되지 않습니다.",
    ],
    [ReviewMessages.Before]: ["发布前审查", "發布前審查", "게시 전 심사"],
    [ReviewMessages.After]: ["发布后审查", "發布後審查", "게시 후 심사"],
    [ReviewMessages.ReportLimit]: ["举报数超过此值后下架", "檢舉數超過此值後下架", "비공개 처리 신고 초과 기준"],
    [ReviewMessages.RejectionLimit]: ["审查拒绝次数上限", "審查拒絕次數上限", "최대 심사 거부 횟수"],
    [ReviewMessages.Reminders]: ["启用审查员提醒", "啟用審查員提醒", "심사자 알림 활성화"],
    [ReviewMessages.Interval]: ["汇总周期（分钟）", "彙總週期（分鐘）", "요약 주기 (분)"],
    [ReviewMessages.ReminderScope]: [
        "审查员提醒开关不影响作者的审核结果通知。",
        "審查員提醒開關不影響作者的審核結果通知。",
        "심사자 알림 설정은 작성자의 심사 결과 알림에 영향을 주지 않습니다.",
    ],
    [ReviewMessages.Pending]: ["待审查", "待審查", "심사 대기"],
    [ReviewMessages.Required]: ["需要审查", "需要審查", "심사 필요"],
    [ReviewMessages.Rejected]: ["审查未通过", "審查未通過", "심사 거부됨"],
    [ReviewMessages.Blocked]: [
        "审查拒绝次数已达上限，禁止发布。",
        "審查拒絕次數已達上限，禁止發布。",
        "심사 거부 횟수 제한으로 게시할 수 없습니다.",
    ],
    [ReviewMessages.Unavailable]: ["当前文章不能举报。", "目前文章無法檢舉。", "이 게시물은 신고할 수 없습니다."],
    [ReviewMessages.AlreadyReported]: [
        "你已举报过此内容版本。",
        "你已檢舉過此內容版本。",
        "이미 이 버전을 신고했습니다.",
    ],
    [ReviewMessages.ReportAccepted]: ["举报已受理。", "檢舉已受理。", "신고가 접수되었습니다."],
    [ReviewMessages.Changed]: [
        "审查状态已变更，请刷新后重试。",
        "審查狀態已變更，請重新整理後再試。",
        "심사 상태가 변경되었습니다. 새로고침 후 다시 시도하세요.",
    ],
    [ReviewMessages.Integrity]: [
        "举报记录暂时无法完成，请稍后重试。",
        "檢舉紀錄暫時無法完成，請稍後再試。",
        "신고 처리를 완료할 수 없습니다. 나중에 다시 시도하세요.",
    ],
    [ReviewMessages.Approve]: ["通过文章审查", "通過文章審查", "게시물 승인"],
    [ReviewMessages.Reject]: ["拒绝文章", "拒絕文章", "게시물 거부"],
    [ReviewMessages.Reset]: ["清零审查计数", "清零審查計數", "심사 횟수 초기화"],
    [ReviewMessages.ResetConfirm]: [
        "清零两个计数器？这不会发布文章或通过审查。",
        "清零兩個計數器？這不會發布文章或通過審查。",
        "두 횟수를 초기화할까요? 게시하거나 승인하지는 않습니다.",
    ],
    [ReviewMessages.Withdraw]: ["撤回审查", "撤回審查", "심사 철회"],
    [ReviewMessages.Comments]: ["拒绝意见（可选）", "拒絕意見（選填）", "심사 의견 (선택)"],
    [ReviewMessages.ReportComments]: ["举报说明（可选）", "檢舉說明（選填）", "신고 설명 (선택)"],
    [ReviewMessages.Reports]: ["举报", "檢舉", "신고"],
    [ReviewMessages.Rejections]: ["拒绝次数", "拒絕次數", "거부 횟수"],
    [ReviewMessages.Version]: ["内容版本", "內容版本", "내용 버전"],
    [ReviewMessages.Publication]: ["发布审查", "發布審查", "게시 심사"],
    [ReviewMessages.Report]: ["举报审查", "檢舉審查", "신고 심사"],
    [ReviewMessages.Empty]: ["没有待审查文章。", "沒有待審查文章。", "심사 대기 게시물이 없습니다."],
    [ReviewMessages.ApprovedNotice]: [
        "你的博客文章“{0}”（版本 {1}）已通过审查（{2:link}）。",
        "你的部落格文章「{0}」（版本 {1}）已通過審查（{2:link}）。",
        '블로그 게시물 "{0}" (버전 {1})이 승인되었습니다 ({2:link}).',
    ],
    [ReviewMessages.RejectedNotice]: [
        "你的博客文章“{0}”（版本 {1}）未通过审查。{2}（{3:link}）。",
        "你的部落格文章「{0}」（版本 {1}）未通過審查。{2}（{3:link}）。",
        '블로그 게시물 "{0}" (버전 {1})이 거부되었습니다. {2} ({3:link}).',
    ],
    [ReviewMessages.HiddenNotice]: [
        "你的博客文章“{0}”（版本 {1}）因举报已下架（{2:link}）。",
        "你的部落格文章「{0}」（版本 {1}）因檢舉已下架（{2:link}）。",
        '블로그 게시물 "{0}" (버전 {1})이 신고로 비공개 처리되었습니다 ({2:link}).',
    ],
    [ReviewMessages.SummaryNotice]: [
        "当前有 {0} 篇博客文章待审查（{1:link}）。",
        "目前有 {0} 篇部落格文章待審查（{1:link}）。",
        "심사 대기 중인 블로그 게시물이 {0}개 있습니다 ({1:link}).",
    ],
};

export function applyI18n(ctx: Context) {
    const labels: Record<string, [string, string, string, string]> = {
        [BLOG_PERMISSION_LABELS.REVIEW]: [
            "Review blog articles",
            "审查博客文章",
            "審查部落格文章",
            "블로그 게시물 심사",
        ],
        [BLOG_PERMISSION_LABELS.RESET_REVIEW_COUNTERS]: [
            "Reset article review counters",
            "清零文章审查计数",
            "清零文章審查計數",
            "게시물 심사 횟수 초기화",
        ],
        [BLOG_PERMISSION_LABELS.ACCESS]: ["Access blogs", "访问博客", "存取部落格", "블로그 접근"],
        [BLOG_PERMISSION_LABELS.VIEW_PUBLISHED]: [
            "Read published articles",
            "阅读已发布文章",
            "閱讀已發布文章",
            "공개 게시물 읽기",
        ],
        [BLOG_PERMISSION_LABELS.VIEW_DRAFT_OWN]: [
            "Read own drafts",
            "阅读自己的草稿",
            "閱讀自己的草稿",
            "내 초안 읽기",
        ],
        [BLOG_PERMISSION_LABELS.VIEW_DRAFT_OTHERS]: [
            "Read others' drafts",
            "阅读他人的草稿",
            "閱讀他人的草稿",
            "다른 사용자의 초안 읽기",
        ],
        [BLOG_PERMISSION_LABELS.CREATE]: ["Create articles", "创建文章", "建立文章", "게시물 작성"],
        [BLOG_PERMISSION_LABELS.EDIT_OWN]: ["Edit own articles", "编辑自己的文章", "編輯自己的文章", "내 게시물 수정"],
        [BLOG_PERMISSION_LABELS.EDIT_OTHERS]: [
            "Edit others' articles",
            "编辑他人的文章",
            "編輯他人的文章",
            "다른 사용자의 게시물 수정",
        ],
        [BLOG_PERMISSION_LABELS.PUBLISH_OWN]: [
            "Publish/update own public articles",
            "发布或更新自己的公开文章",
            "發布或更新自己的公開文章",
            "내 공개 게시물 게시 및 수정",
        ],
        [BLOG_PERMISSION_LABELS.PUBLISH_OTHERS]: [
            "Publish/update others' public articles",
            "发布或更新他人的公开文章",
            "發布或更新他人的公開文章",
            "다른 사용자의 공개 게시물 게시 및 수정",
        ],
        [BLOG_PERMISSION_LABELS.UNPUBLISH_OWN]: [
            "Unpublish own articles",
            "撤回自己的文章",
            "撤回自己的文章",
            "내 게시물 공개 취소",
        ],
        [BLOG_PERMISSION_LABELS.UNPUBLISH_OTHERS]: [
            "Unpublish others' articles",
            "撤回他人的文章",
            "撤回他人的文章",
            "다른 사용자의 게시물 공개 취소",
        ],
        [BLOG_PERMISSION_LABELS.PIN_OWN]: [
            "Pin/unpin own articles",
            "置顶或取消置顶自己的文章",
            "置頂或取消置頂自己的文章",
            "내 게시물 고정 및 해제",
        ],
        [BLOG_PERMISSION_LABELS.PIN_OTHERS]: [
            "Pin/unpin others' articles",
            "置顶或取消置顶他人的文章",
            "置頂或取消置頂他人的文章",
            "다른 사용자의 게시물 고정 및 해제",
        ],
        [BLOG_PERMISSION_LABELS.DELETE_OWN]: [
            "Delete own articles",
            "删除自己的文章",
            "刪除自己的文章",
            "내 게시물 삭제",
        ],
        [BLOG_PERMISSION_LABELS.DELETE_OTHERS]: [
            "Delete others' articles",
            "删除他人的文章",
            "刪除他人的文章",
            "다른 사용자의 게시물 삭제",
        ],
        [BLOG_PERMISSION_LABELS.STAR]: ["Star articles", "收藏文章", "收藏文章", "게시물 즐겨찾기"],
        [BLOG_PERMISSION_LABELS.CREATE_COMMENT]: [
            "Post comments/replies and like/unlike",
            "发表评论、回复及点赞/取消点赞",
            "發表評論、回覆及按讚/取消按讚",
            "댓글/답글 작성 및 좋아요/취소",
        ],
        [BLOG_PERMISSION_LABELS.DELETE_COMMENT_OWN]: [
            "Delete own comments/replies",
            "删除自己的评论和回复",
            "刪除自己的評論和回覆",
            "내 댓글/답글 삭제",
        ],
        [BLOG_PERMISSION_LABELS.DELETE_COMMENT]: [
            "Moderate comments/replies (discussion deletion rules)",
            "管理删除评论和回复（遵循讨论删除规则）",
            "管理刪除評論和回覆（遵循討論刪除規則）",
            "댓글/답글 관리 삭제 (토론 삭제 규칙)",
        ],
        [BLOG_PERMISSION_LABELS.DELETE_COMMENT_IN_OWN_POST]: [
            "Delete top-level comments on own articles",
            "删除自己文章下的一级评论",
            "刪除自己文章下的一級評論",
            "내 게시물의 최상위 댓글 삭제",
        ],
        [BlogMessages.Comments]: [BlogMessages.Comments, "博客评论", "部落格評論", "블로그 댓글"],
        [BlogMessages.CommentScope]: [
            BlogMessages.CommentScope,
            "评论删除遵循讨论规则：文章作者管理权限仅适用于一级评论。",
            "評論刪除遵循討論規則：文章作者管理權限僅適用於一級評論。",
            "댓글 삭제는 토론 규칙을 따릅니다. 작성자 관리 권한은 최상위 댓글에만 적용됩니다.",
        ],
        [BlogMessages.CommentsPublishedOnly]: [
            BlogMessages.CommentsPublishedOnly,
            "仅已发布文章支持评论和点赞。",
            "僅已發佈文章支援評論和按讚。",
            "공개 게시물에서만 댓글과 좋아요를 사용할 수 있습니다.",
        ],
        [BlogMessages.CommentUnavailable]: [
            BlogMessages.CommentUnavailable,
            "评论或文章已不存在。",
            "評論或文章已不存在。",
            "댓글 또는 게시물을 더 이상 사용할 수 없습니다.",
        ],
        [BlogMessages.LikeComment]: [BlogMessages.LikeComment, "点赞评论", "按讚評論", "댓글 좋아요"],
        [BlogMessages.UnlikeComment]: [BlogMessages.UnlikeComment, "取消点赞", "取消按讚", "좋아요 취소"],
        [BlogMessages.CommentDeleted]: [
            BlogMessages.CommentDeleted,
            "{0} {1} 删除了你在博客“{3}”中的评论 {2}（{4:link}）。",
            "{0} {1} 刪除了你在部落格「{3}」中的評論 {2}（{4:link}）。",
            '{0} {1}님이 블로그 "{3}"의 댓글 {2}을(를) 삭제했습니다 ({4:link}).',
        ],
        [BlogMessages.TailReplyDeleted]: [
            BlogMessages.TailReplyDeleted,
            "管理员 {0} 删除了你在博客“{2}”中的回复 {1}（{3:link}）。",
            "管理員 {0} 刪除了你在部落格「{2}」中的回覆 {1}（{3:link}）。",
            '관리자 {0}님이 블로그 "{2}"의 답글 {1}을(를) 삭제했습니다 ({3:link}).',
        ],
        [BLOG_PERMISSION_LABELS.MANAGE_SETTINGS]: [
            "Manage blog settings",
            "管理博客设置",
            "管理部落格設定",
            "블로그 설정 관리",
        ],
        [BlogMessages.Settings]: [BlogMessages.Settings, "博客设置", "部落格設定", "블로그 설정"],
        [BlogMessages.Articles]: [BlogMessages.Articles, "博客文章", "部落格文章", "블로그 게시물"],
        [BlogMessages.YourRole]: [BlogMessages.YourRole, "你的博客角色", "你的部落格角色", "내 블로그 역할"],
        [BlogMessages.GlobalScope]: [
            BlogMessages.GlobalScope,
            "博客权限在所有域中一致生效。",
            "部落格權限在所有域中一致生效。",
            "블로그 권한은 모든 도메인에 동일하게 적용됩니다.",
        ],
        [BlogMessages.PermissionScope]: [
            BlogMessages.PermissionScope,
            "自己与他人的权限独立控制；访问权限和登录验证要求仍然适用。",
            "自己與他人的權限獨立控制；存取權限和登入驗證要求仍然適用。",
            "본인과 다른 사용자의 권한은 별개이며 접근 권한과 인증이 필요합니다.",
        ],
        [BlogMessages.DefaultRoles]: [
            BlogMessages.DefaultRoles,
            "未分配用户使用 default，匿名用户使用 guest，系统编辑者始终使用 root。",
            "未分配使用者使用 default，匿名使用者使用 guest，系統編輯者始終使用 root。",
            "미지정 사용자는 default, 익명 사용자는 guest, 시스템 관리자는 항상 root입니다.",
        ],
        [BlogMessages.RoleLifecycle]: [
            BlogMessages.RoleLifecycle,
            "新角色复制 default 权限；删除角色后，其用户回到 default。",
            "新角色複製 default 權限；刪除角色後，其使用者回到 default。",
            "새 역할은 default 권한을 복사하며 역할 삭제 시 사용자는 default로 돌아갑니다.",
        ],
        [BlogMessages.RoleList]: [
            BlogMessages.RoleList,
            "博客权限对全体用户生效，不存在加入或退出。此列表仅显示 root 和自定义角色用户。",
            "部落格權限對全體使用者生效，不存在加入或退出。此列表僅顯示 root 和自訂角色使用者。",
            "블로그 권한은 가입이나 탈퇴 없이 모든 사용자에게 적용됩니다. root 및 사용자 지정 역할만 표시합니다.",
        ],
        [BlogMessages.AssignUserRoles]: [
            BlogMessages.AssignUserRoles,
            "设置用户角色",
            "設定使用者角色",
            "사용자 역할 지정",
        ],
        [BlogMessages.ForcedRoot]: [
            BlogMessages.ForcedRoot,
            "由系统权限强制指定",
            "由系統權限強制指定",
            "시스템 권한으로 지정됨",
        ],
        [BlogMessages.ResetDefault]: [BlogMessages.ResetDefault, "恢复 default", "恢復 default", "default로 초기화"],
        [BlogMessages.DeleteRolesConfirm]: [
            BlogMessages.DeleteRolesConfirm,
            "删除所选角色？这些角色的用户将恢复为 default。",
            "刪除所選角色？這些角色的使用者將恢復為 default。",
            "선택한 역할을 삭제할까요? 해당 사용자는 default로 돌아갑니다.",
        ],
        [BlogMessages.SetRole]: [BlogMessages.SetRole, "设置角色", "設定角色", "역할 지정"],
        Publish: [BlogMessages.Publish, "发布", "發布", "게시"],
        Unpublish: [BlogMessages.Unpublish, "撤回发布", "撤回發布", "게시 취소"],
        Unpin: [BlogMessages.Unpin, "取消置顶", "取消置頂", "고정 해제"],
        [BlogMessages.SettingsChanged]: [
            BlogMessages.SettingsChanged,
            "博客设置已变更，请刷新后重试。",
            "部落格設定已變更，請重新整理後再試。",
            "설정이 변경되었습니다. 새로고침 후 다시 시도하세요.",
        ],
        [BlogMessages.ArticleChanged]: [
            BlogMessages.ArticleChanged,
            "文章已变更，请刷新后重试。",
            "文章已變更，請重新整理後再試。",
            "게시물이 변경되었습니다. 새로고침 후 다시 시도하세요.",
        ],
        [BlogMessages.RoleExists]: [BlogMessages.RoleExists, "角色已存在。", "角色已存在。", "역할이 이미 존재합니다."],
        [BlogMessages.PermissionDenied]: [
            BlogMessages.PermissionDenied,
            "你没有所需的博客权限：{0}。",
            "你沒有所需的部落格權限：{0}。",
            "필요한 블로그 권한이 없습니다: {0}.",
        ],
    };
    for (const [index, language] of ["en", "zh", "zh_TW", "ko"].entries()) {
        ctx.i18n.load(
            language,
            Object.fromEntries(
                Object.entries(reviewLabels).map(([key, values]) => [key, index ? values[index - 1] : key]),
            ),
        );
        ctx.i18n.load(
            language,
            Object.fromEntries(
                [ROUTE_BLOG_REVIEW, ROUTE_BLOG_REVIEW_DETAIL, ROUTE_BLOG_REVIEW_RESET].map((route) => [
                    route,
                    index ? reviewLabels[ReviewMessages.Title][index - 1] : ReviewMessages.Title,
                ]),
            ),
        );
        ctx.i18n.load(
            language,
            Object.fromEntries(Object.entries(labels).map(([key, values]) => [key, values[index]])),
        );
        ctx.i18n.load(
            language,
            Object.fromEntries(BLOG_SETTINGS_PAGES.map((page) => [page, labels[BlogMessages.Settings][index]])),
        );
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
