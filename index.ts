import type { Context } from "hydrooj";

import { applyHandler } from "./features/handler";
import { applyI18n } from "./features/i18n";
import { injectUI } from "./features/ui";

export function apply(ctx: Context) {
    applyI18n(ctx);
    applyHandler(ctx);
    injectUI(ctx);
}
