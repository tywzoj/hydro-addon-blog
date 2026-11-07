import type { Context, Handler } from "hydrooj";

import {
    BlogPermissions,
    ReviewModes,
    ROUTE_BLOG_LIST_HOME,
    ROUTE_BLOG_LIST_USER,
    ROUTE_BLOG_REVIEW,
} from "./constants";
import { BlogSettingsModel } from "./settings.model";

export function injectUI(ctx: Context) {
    ctx.on("handler/before", async (handler) => {
        const policy = await BlogSettingsModel.forRequest(handler);
        const review = await BlogSettingsModel.review();
        handler.UiContext.blogReviewMode = review.mode;
        handler.UiContext.blogAccess = policy.has(BlogPermissions.ACCESS);
        handler.UiContext.blogPublished = policy.has(BlogPermissions.VIEW_PUBLISHED);
        handler.UiContext.blogAuthenticated = policy.authenticated;
        handler.UiContext.blogReviewer = review.mode !== ReviewModes.Disabled && policy.canReview();
    });
    ctx.injectUI("UserDropdown", ROUTE_BLOG_REVIEW, { icon: "check" }, (h: Handler) => !!h.UiContext.blogReviewer);
    ctx.injectUI(
        "UserDropdown",
        ROUTE_BLOG_LIST_USER,
        (h: Handler) => ({ icon: "book", uid: h.user._id.toString() }),
        (h: Handler) => !!h.UiContext.blogAccess && !!h.UiContext.blogAuthenticated,
    );
    ctx.injectUI(
        "Nav",
        ROUTE_BLOG_LIST_HOME,
        { prefix: "blog", before: "record_main" },
        (h: Handler) => !!h.UiContext.blogAccess && !!h.UiContext.blogPublished,
    );
}
