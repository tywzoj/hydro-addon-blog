import { join } from "node:path";

import type { Page } from "@playwright/test";
import { expect, test as base } from "@playwright/test";
import type { Db } from "mongodb";
import { MongoClient } from "mongodb";

export const test = base.extend<{ viewer: Page; editor: Page; db: Db }>({
    viewer: async ({ browser, baseURL }, use) => {
        const context = await browser.newContext({
            baseURL,
            storageState: join(process.env.HYDRO_E2E_OUTPUT!, "auth", "viewer.json"),
        });
        try {
            await use(await context.newPage());
        } finally {
            await context.close();
        }
    },
    editor: async ({ browser, baseURL }, use) => {
        const context = await browser.newContext({
            baseURL,
            storageState: join(process.env.HYDRO_E2E_OUTPUT!, "auth", "editor.json"),
        });
        try {
            await use(await context.newPage());
        } finally {
            await context.close();
        }
    },
    db: async ({ browserName: _browserName }, use) => {
        const uri = process.env.HYDRO_E2E_MONGO_URI;
        if (!uri?.match(/^mongodb:\/\/127\.0\.0\.1:\d+\/blog_e2e$/)) {
            throw new Error("E2E database access requires the run-owned loopback MongoDB");
        }
        const client = new MongoClient(uri);
        try {
            await client.connect();
            await use(client.db());
        } finally {
            await client.close();
        }
    },
});

export { expect };

export async function fillPost(page: Page, title: string, content: string, draft: boolean) {
    await page.locator('input[name="title"]').fill(title);
    await page.locator(".cm-content[contenteditable=true]").fill(content);
    await expect(page.locator('textarea[name="content"]')).toHaveValue(content);
    await page.locator('input[name="draft"]').setChecked(draft);
}

export async function submitPost(page: Page) {
    await Promise.all([
        page.waitForURL(/\/blog\/2\/[a-f0-9]{24}$/, { waitUntil: "domcontentloaded" }),
        page.locator('button[name="operation"][value="submit"]').click(),
    ]);
    return new URL(page.url()).pathname;
}

export async function createPost(page: Page, title: string, draft = false) {
    await page.goto("/blog/2/create");
    await fillPost(page, title, `Body for ${title}`, draft);
    return await submitPost(page);
}
