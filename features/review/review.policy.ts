import { ValidationError } from "hydrooj";

import { REVIEW_COMMENT_MAX, ReviewMessages, ReviewModes, ReviewReasons } from "../shared/constants";
import type { BlogDoc, BlogReviewSettings, BlogUpdate } from "../shared/types";

export function reviewComment(value: unknown): string {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value !== "string" || value.trim().length > REVIEW_COMMENT_MAX) {
        throw new ValidationError("comments");
    }
    return value.trim();
}

export const OptionalReviewComment = [reviewComment, () => true] as const;

export function publicationUpdate(
    doc: BlogDoc,
    update: BlogUpdate,
    settings: BlogReviewSettings,
    withdraw = false,
): Partial<BlogDoc> {
    const result: Partial<BlogDoc> = { ...update };
    const changed =
        (update.title !== undefined && update.title !== doc.title) ||
        (update.content !== undefined && update.content !== doc.content);
    if (changed) result.contentVersion = (doc.contentVersion ?? 0) + 1;
    if (withdraw) {
        result.draft = true;
        result.reviewPending = false;
        result.reviewGeneration = (doc.reviewGeneration ?? 0) + 1;
        return result;
    }
    const publishing = update.draft === false && (!!doc.draft || changed);
    if (publishing && (doc.rejectionCount ?? 0) >= settings.rejectionLimit) {
        throw new ValidationError("post", null, ReviewMessages.Blocked);
    }
    if (publishing && (settings.mode === ReviewModes.Before || (doc.requiresReview && doc.draft))) {
        result.draft = true;
        result.requiresReview = true;
        result.reviewPending = true;
        result.reviewReason = doc.requiresReview
            ? (doc.reviewReason ?? ReviewReasons.Publication)
            : ReviewReasons.Publication;
        result.reviewQueuedAt = doc.reviewPending ? doc.reviewQueuedAt : new Date();
    }
    if ((changed && doc.reviewPending) || result.reviewPending) {
        result.reviewGeneration = (doc.reviewGeneration ?? 0) + 1;
    }
    return result;
}
