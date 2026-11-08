import type en from "./en";

// Keep these absent from English registration so Hydro retains its source-text fallback.
export const SOURCE_TEXT_KEYS = [
    "{0}'s blog",
    "Blog",
    "Create a Post",
    "Updated at: {0}",
    "First published at: {0}",
    "Published at: {0}",
    "No post yet...",
    "Views: {0}",
    "Draft",
] as const;

export type BlogLocale = Record<keyof typeof en | (typeof SOURCE_TEXT_KEYS)[number], string>;
