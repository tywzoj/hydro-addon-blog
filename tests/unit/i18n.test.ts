import type { Context } from "hydrooj";
import { describe, expect, it, vi } from "vitest";

import { applyBlogI18n } from "../../features/integration/i18n";
import { SOURCE_TEXT_KEYS } from "../../features/integration/locales/catalog";
import en from "../../features/integration/locales/en";
import {
    BLOG_PERMISSION_LABELS,
    BLOG_SETTINGS_PAGES,
    BlogMessages,
    ReviewMessages,
    ROUTE_BLOG_REVIEW,
    ROUTE_BLOG_REVIEW_DETAIL,
    ROUTE_BLOG_REVIEW_RESET,
} from "../../features/shared/constants";

function register() {
    const load = vi.fn<(language: string, messages: Record<string, string>) => void>();
    applyBlogI18n({ i18n: { load } } as unknown as Context);
    return load.mock.calls;
}

function placeholders(text: string) {
    return (text.match(/\{\d+(?::[^}]+)?\}/g) || []).sort();
}

describe("blog locale registration", () => {
    it("registers complete catalogs while preserving English source-text fallback", () => {
        const calls = register();
        expect(calls.map(([language]) => language)).toEqual(["en", "zh", "zh_TW", "ko"]);
        const translatedKeys = [...Object.keys(en), ...SOURCE_TEXT_KEYS].sort();
        for (const [language, messages] of calls) {
            expect(Object.keys(messages).sort()).toEqual(language === "en" ? Object.keys(en).sort() : translatedKeys);
            for (const key of [...Object.values(BLOG_PERMISSION_LABELS), ...BLOG_SETTINGS_PAGES]) {
                expect(messages[key]?.trim(), `${language}: ${key}`).toBeTruthy();
            }
        }
        for (const key of SOURCE_TEXT_KEYS) expect(calls[0][1]).not.toHaveProperty([key]);
    });

    it.each(["en", "zh", "zh_TW", "ko"])("preserves interpolation tokens and link formatting in %s", (language) => {
        const messages = register().find(([locale]) => locale === language)![1];
        const english: Record<string, string> = en;
        for (const [key, text] of Object.entries(messages)) {
            expect(text.trim(), `${language}: ${key}`).not.toBe("");
            expect(placeholders(text), `${language}: ${key}`).toEqual(placeholders(english[key] ?? key));
        }
    });

    it("keeps route titles consistent with the localized feature titles", () => {
        for (const [, messages] of register()) {
            for (const route of [ROUTE_BLOG_REVIEW, ROUTE_BLOG_REVIEW_DETAIL, ROUTE_BLOG_REVIEW_RESET]) {
                expect(messages[route]).toBe(messages[ReviewMessages.Title]);
            }
            for (const route of BLOG_SETTINGS_PAGES) expect(messages[route]).toBe(messages[BlogMessages.Settings]);
        }
    });

    it("gives each application independent catalog objects for Hydro effect disposal", () => {
        const first = register();
        const second = register();
        for (const [index, [, messages]] of first.entries()) {
            expect(messages).toEqual(second[index][1]);
            expect(messages).not.toBe(second[index][1]);
            messages[BlogMessages.Settings] = "Changed only in this application";
        }
        expect(register()).toEqual(second);
    });
});
