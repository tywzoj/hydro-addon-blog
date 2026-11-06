import type { Context } from "hydrooj";

import { ensureCommentIndexes } from "./features/comments.model";
import { applyHandler } from "./features/handler";
import { applyI18n } from "./features/i18n";
import { ensureIndexes } from "./features/model";
import { applySettingsHandler } from "./features/settings.handler";
import { BlogSettingsModel } from "./features/settings.model";
import { injectUI } from "./features/ui";

export async function apply(ctx: Context) {
    await ensureIndexes(ctx);
    await ensureCommentIndexes(ctx);
    await BlogSettingsModel.init(ctx);
    applyI18n(ctx);
    applySettingsHandler(ctx);
    applyHandler(ctx);
    injectUI(ctx);
}
