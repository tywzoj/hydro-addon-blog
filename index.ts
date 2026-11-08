import type { Context } from "hydrooj";

import { applyArticleHandlers, BlogModel } from "./features/articles";
import { BlogCommentModel } from "./features/comments";
import { applyBlogI18n, applyBlogUI } from "./features/integration";
import { applyReviewHandlers, applyReviewNotifications, BlogReviewModel } from "./features/review";
import { applySettingsHandlers, BlogSettingsModel } from "./features/settings";

export async function apply(ctx: Context) {
    await BlogModel.init(ctx);
    await BlogCommentModel.init(ctx);
    await BlogSettingsModel.init(ctx);
    await BlogReviewModel.init(ctx);
    applyBlogI18n(ctx);
    applySettingsHandlers(ctx);
    applyReviewHandlers(ctx);
    applyArticleHandlers(ctx);
    applyBlogUI(ctx);
    applyReviewNotifications(ctx);
}
