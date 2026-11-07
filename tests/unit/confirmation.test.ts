import { describe, expect, it } from "vitest";

import { BlogConfirmMessages, BlogOperations, ReviewMessages } from "../../features/constants";
import { confirmationMessage, isSubmitShortcut } from "../../frontend/blog-confirmation";

describe("article submission shortcuts", () => {
    const key = { key: "Enter", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false };

    it("accepts either native submit modifier without capturing other editor shortcuts", () => {
        expect(isSubmitShortcut({ ...key, ctrlKey: true })).toBe(true);
        expect(isSubmitShortcut({ ...key, metaKey: true })).toBe(true);
        expect(isSubmitShortcut(key)).toBe(false);
        for (const change of [{ key: "s" }, { altKey: true }, { shiftKey: true }, { isComposing: true }]) {
            expect(isSubmitShortcut({ ...key, ctrlKey: true, ...change })).toBe(false);
        }
    });
});

describe("critical action confirmations", () => {
    it("distinguishes publication, live edits, and withdrawal from ordinary draft saves", () => {
        const operation = BlogOperations.Submit;
        expect(confirmationMessage({ operation, draft: true, wasDraft: true })).toBeUndefined();
        expect(confirmationMessage({ operation, draft: false, wasDraft: true })).toBe(BlogConfirmMessages.Publish);
        expect(confirmationMessage({ operation, draft: false, wasDraft: false })).toBe(
            BlogConfirmMessages.UpdatePublished,
        );
        expect(confirmationMessage({ operation, draft: true, wasDraft: false })).toBe(BlogConfirmMessages.Unpublish);
        expect(confirmationMessage({ operation: BlogOperations.Publish, draft: true })).toBe(
            BlogConfirmMessages.Unpublish,
        );
        expect(confirmationMessage({ operation: BlogOperations.Publish, draft: false })).toBe(
            BlogConfirmMessages.Publish,
        );
    });

    it("describes review only when publication requires it or a pending review is withdrawn", () => {
        expect(confirmationMessage({ operation: BlogOperations.Publish, draft: false, reviewRequired: true })).toBe(
            BlogConfirmMessages.SubmitReview,
        );
        expect(confirmationMessage({ operation: BlogOperations.Publish, draft: true, reviewPending: true })).toBe(
            BlogConfirmMessages.Withdraw,
        );
        expect(
            confirmationMessage({
                operation: BlogOperations.Submit,
                draft: false,
                wasDraft: false,
                reviewRequired: true,
            }),
        ).toBe(BlogConfirmMessages.UpdateReviewed);
        expect(confirmationMessage({ operation: BlogOperations.ReviewSettings, mode: "disabled" })).toBe(
            BlogConfirmMessages.DisableReview,
        );
        expect(confirmationMessage({ operation: BlogOperations.ReviewSettings, mode: "before" })).toBeUndefined();
    });
    it("uses the selected destructive or review action rather than the form's publication state", () => {
        expect(confirmationMessage({ operation: BlogOperations.Delete, draft: false })).toBe(
            BlogConfirmMessages.Delete,
        );
        expect(confirmationMessage({ operation: BlogOperations.Decide, decision: "approve" })).toBe(
            BlogConfirmMessages.Approve,
        );
        expect(confirmationMessage({ operation: BlogOperations.Decide, decision: "reject" })).toBe(
            BlogConfirmMessages.Reject,
        );
        expect(confirmationMessage({ operation: BlogOperations.ResetReview })).toBe(ReviewMessages.ResetConfirm);
        expect(confirmationMessage({ operation: BlogOperations.Decide })).toBeUndefined();
    });

    it("does not interrupt unrelated metadata operations or add a second reporting confirmation", () => {
        for (const operation of [BlogOperations.Pin, BlogOperations.Star, BlogOperations.Report]) {
            expect(confirmationMessage({ operation, draft: false, wasDraft: false })).toBeUndefined();
        }
    });
});
