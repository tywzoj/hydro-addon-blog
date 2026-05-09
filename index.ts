import type { Context, Handler } from "hydrooj";
import { PRIV } from "hydrooj";

import { applyHandler } from "./features/handler";
import { applyI18n } from "./features/i18n";

export function apply(ctx: Context) {
    applyHandler(ctx);

    ctx.injectUI(
        "UserDropdown",
        "blog_main",
        (h: Handler) => ({ icon: "book", displayName: "Blog", uid: h.user._id.toString() }),
        PRIV.PRIV_USER_PROFILE,
    );

    applyI18n(ctx);
}
