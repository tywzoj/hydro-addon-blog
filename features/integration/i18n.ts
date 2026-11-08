import type { Context } from "hydrooj";

import en from "./locales/en";
import ko from "./locales/ko";
import zh from "./locales/zh";
import zhTW from "./locales/zh_TW";

const BLOG_LOCALES = { en, zh, zh_TW: zhTW, ko };

export function applyBlogI18n(ctx: Context) {
    for (const [language, messages] of Object.entries(BLOG_LOCALES)) {
        ctx.i18n.load(language, { ...messages });
    }
}
