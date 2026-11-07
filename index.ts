import type { Context } from "hydrooj";

import { ensureCommentIndexes } from "./features/comments.model";
import { applyHandler } from "./features/handler";
import { applyI18n } from "./features/i18n";
import { ensureIndexes } from "./features/model";
import { applyReviewHandler } from "./features/review.handler";
import { BlogReviewModel } from "./features/review.model";
import { applyReviewNotifications } from "./features/review.notifications";
import { applySettingsHandler } from "./features/settings.handler";
import { BlogSettingsModel } from "./features/settings.model";
import { injectUI } from "./features/ui";

export async function apply(ctx: Context) {
    await ensureIndexes(ctx);
    await ensureCommentIndexes(ctx);
    await BlogSettingsModel.init(ctx);
    await BlogReviewModel.init(ctx);
    applyI18n(ctx);
    applySettingsHandler(ctx);
    applyReviewHandler(ctx);
    applyHandler(ctx);
    injectUI(ctx);
    applyReviewNotifications(ctx);
}
