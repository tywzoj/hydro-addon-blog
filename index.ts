import type { Context } from "hydrooj";

import { applyHandler } from "./features/handler";
import { applyI18n } from "./features/i18n";
import { ensureIndexes } from "./features/model";
import { injectUI } from "./features/ui";

export async function apply(ctx: Context) {
    await ensureIndexes(ctx);
    applyI18n(ctx);
    applyHandler(ctx);
    injectUI(ctx);
}
