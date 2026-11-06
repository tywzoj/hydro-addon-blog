import type { Context, Handler } from "hydrooj";

import { ROUTE_BLOG_LIST_HOME, ROUTE_BLOG_LIST_USER } from "./constants";
import { BlogSettingsModel } from "./settings.model";

export function injectUI(ctx: Context) {
    ctx.on("handler/before", async (handler) => {
        const policy = await BlogSettingsModel.forRequest(handler);
        handler.UiContext.blogAccess = policy.has("ACCESS");
        handler.UiContext.blogPublished = policy.has("VIEW_PUBLISHED");
        handler.UiContext.blogAuthenticated = policy.authenticated;
    });
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
