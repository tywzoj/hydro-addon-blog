import type { Context, Handler } from "hydrooj";
import { PRIV } from "hydrooj";

import { ROUTE_BLOG_LIST_HOME, ROUTE_BLOG_LIST_USER } from "./constants";

export function injectUI(ctx: Context) {
    ctx.injectUI(
        "UserDropdown",
        ROUTE_BLOG_LIST_USER,
        (h: Handler) => ({ icon: "book", uid: h.user._id.toString() }),
        PRIV.PRIV_USER_PROFILE,
    );
    ctx.injectUI("Nav", ROUTE_BLOG_LIST_HOME, { prefix: "blog", before: "record_main" }, PRIV.PRIV_USER_PROFILE);
}
