import {
    BlogConfirmMessages,
    BlogOperations,
    ReviewDecisions,
    ReviewMessages,
    ReviewModes,
} from "../features/shared/constants";

export function isSubmitShortcut(
    event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing">,
) {
    return (
        event.key === "Enter" &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        !event.isComposing
    );
}

export function confirmationMessage({
    operation,
    decision,
    draft = true,
    wasDraft = true,
    reviewRequired = false,
    reviewPending = false,
    mode,
}: {
    operation?: string | null;
    decision?: string | null;
    draft?: boolean;
    wasDraft?: boolean;
    reviewRequired?: boolean;
    reviewPending?: boolean;
    mode?: string | null;
}) {
    if (operation === BlogOperations.Delete) return BlogConfirmMessages.Delete;
    if (operation === BlogOperations.Publish) {
        if (draft) return reviewPending ? BlogConfirmMessages.Withdraw : BlogConfirmMessages.Unpublish;
        return reviewRequired ? BlogConfirmMessages.SubmitReview : BlogConfirmMessages.Publish;
    }
    if (operation === BlogOperations.Submit) {
        if (!draft) {
            if (reviewRequired) return wasDraft ? BlogConfirmMessages.SubmitReview : BlogConfirmMessages.UpdateReviewed;
            return wasDraft ? BlogConfirmMessages.Publish : BlogConfirmMessages.UpdatePublished;
        }
        if (!wasDraft) return BlogConfirmMessages.Unpublish;
    }
    if (operation === BlogOperations.Decide) {
        if (decision === ReviewDecisions.Approve) return BlogConfirmMessages.Approve;
        if (decision === ReviewDecisions.Reject) return BlogConfirmMessages.Reject;
    }
    if (operation === BlogOperations.ResetReview) return ReviewMessages.ResetConfirm;
    if (operation === BlogOperations.ReviewSettings && mode === ReviewModes.Disabled) {
        return BlogConfirmMessages.DisableReview;
    }
    return undefined;
}
