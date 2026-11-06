import type { Page } from "@playwright/test";

import type { BlogPermission } from "../../features/permission";
import { accounts } from "./accounts";
import { createPost, expect, fillPost, test } from "./fixtures";

async function settingsPage(page: Page, path: string, password = accounts.editor.password) {
    await page.goto(path);
    if (new URL(page.url()).pathname.endsWith("/user/sudo")) {
        await page.locator('.immersive--content input[name="password"]').fill(password);
        await Promise.all([
            page.waitForURL((url) => !url.pathname.endsWith("/user/sudo")),
            page.locator('input[name="confirm"]').click(),
        ]);
    }
    await expect(page).toHaveURL(new RegExp(`${path}$`));
}

async function createRole(page: Page, name: string) {
    await settingsPage(page, "/blog/settings/roles");
    await page.locator('input[name="role"]:not([type="hidden"])').fill(name);
    await Promise.all([
        page.waitForNavigation(),
        page.getByRole("button", { name: "Create Role", exact: true }).click(),
    ]);
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
}

async function setPermissions(page: Page, role: string, permissions: BlogPermission[]) {
    await settingsPage(page, "/blog/settings/permissions");
    const names = await page
        .locator("[data-permission]")
        .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-permission")!));
    for (const name of names) {
        await page
            .locator(`[data-permission="${name}"] input[data-role="${role}"]`)
            .setChecked(permissions.includes(name as BlogPermission));
    }
    await Promise.all([page.waitForNavigation(), page.getByRole("button", { name: "Update Permission" }).click()]);
    await expect(page.locator("html")).toHaveAttribute("data-page", "blog_settings_permissions");
}

async function assignRole(page: Page, name: string, role: string) {
    await settingsPage(page, "/blog/settings/users");
    await page.locator(".autocomplete-wrapper input").fill(name.slice(0, -1));
    await page.locator(".user-select__uname").filter({ hasText: name }).click();
    await page.locator('select[name="role"]').selectOption(role);
    await Promise.all([page.waitForNavigation(), page.getByRole("button", { name: "Set Role", exact: true }).click()]);
    await expect(page.locator("html")).toHaveAttribute("data-page", "blog_settings_users");
}

async function resetUser(page: Page, uid: number) {
    await settingsPage(page, "/blog/settings/users");
    const row = page.locator(`tr[data-uid="${uid}"]`);
    await Promise.all([page.waitForNavigation(), row.getByRole("button", { name: "Reset to default" }).click()]);
    await expect(page.locator(`tr[data-uid="${uid}"]`)).toHaveCount(0);
}

test.afterEach(async ({ editor }) => {
    await settingsPage(editor, "/blog/settings/users");
    for (const uid of [2, 3, 4]) {
        const response = await editor.request.post("/blog/settings/users", {
            headers: { Referer: editor.url() },
            form: { operation: "assign", uid: String(uid), role: "default" },
        });
        expect(response.ok()).toBe(true);
    }
    await settingsPage(editor, "/blog/settings/permissions");
    const revision = await editor.locator('input[name="revision"]').inputValue();
    const response = await editor.request.post("/blog/settings/permissions", {
        headers: { Referer: editor.url() },
        form: { revision, "permissions[guest]": "1000" },
    });
    expect(response.ok()).toBe(true);
});

test("global settings role assignment and delegation follow Hydro management semantics", async ({
    editor,
    viewer,
    db,
}) => {
    await settingsPage(editor, "/blog/settings/users");
    await expect(editor.locator('tr[data-uid="2"], tr[data-uid="3"]')).toHaveCount(0);
    await expect(editor.locator('tr[data-uid="4"]')).toContainText("root");
    await createRole(editor, "blogmanager");
    await setPermissions(editor, "blogmanager", ["ACCESS", "VIEW_PUBLISHED", "MANAGE_SETTINGS"]);
    const staleRevision = await editor.locator('input[name="revision"]').inputValue();
    await setPermissions(editor, "blogmanager", ["ACCESS", "VIEW_PUBLISHED", "MANAGE_SETTINGS"]);
    const staleSave = await editor.request.post("/blog/settings/permissions", {
        headers: { Referer: editor.url() },
        form: { revision: staleRevision, "permissions[guest]": "1000" },
    });
    expect(staleSave.status()).toBe(403);
    expect(await staleSave.text()).toContain("Blog settings changed");
    await assignRole(editor, accounts.viewer.name, "blogmanager");
    await expect(editor.locator('tr[data-uid="3"]')).toContainText("blogmanager");
    await settingsPage(viewer, "/blog/settings/permissions", accounts.viewer.password);
    await expect(viewer.locator('input[data-role="root"]').first()).toBeDisabled();
    await assignRole(viewer, accounts.author.name, "root");
    expect(await db.collection("blog.user").findOne({ _id: 2 })).toMatchObject({ role: "root" });
    await resetUser(viewer, 2);
    await resetUser(editor, 3);
    expect((await viewer.goto("/blog/settings"))?.status()).toBe(403);
    await assignRole(editor, accounts.viewer.name, "guest");
    await expect(editor.locator('tr[data-uid="3"]')).toHaveCount(0);
    await assignRole(editor, accounts.editor.name, "guest");
    await expect(editor.locator('tr[data-uid="4"]')).toContainText("root");
});

test("article policy denies private drafts and live edits while allowing independent metadata operations", async ({
    page,
    editor,
    viewer,
    db,
}) => {
    const publicPath = await createPost(page, "Permission public content");
    const draftPath = await createPost(page, "Permission private draft", true);
    expect((await viewer.goto(draftPath))?.status()).toBe(403);
    const deniedJSON = await viewer.request.get(draftPath, { headers: { Accept: "application/json" } });
    expect(deniedJSON.status()).toBe(403);
    expect(await deniedJSON.text()).not.toContain("Body for Permission private draft");

    await createRole(editor, "articlemanager");
    await setPermissions(editor, "articlemanager", [
        "ACCESS",
        "VIEW_PUBLISHED",
        "VIEW_DRAFT_OTHERS",
        "EDIT_OTHERS",
        "PIN_OTHERS",
        "DELETE_OTHERS",
    ]);
    await assignRole(editor, accounts.viewer.name, "articlemanager");
    await viewer.goto(`${publicPath}/edit`);
    const rejected = await viewer.request.post(`${publicPath}/edit`, {
        headers: { Referer: viewer.url() },
        form: { operation: "submit", title: "Rejected public edit", content: "No publish permission", draft: "false" },
    });
    expect(rejected.status()).toBe(403);
    await viewer.goto(`${draftPath}/edit`);
    await viewer.locator('input[name="title"]').fill("Edited third-party draft");
    await Promise.all([viewer.waitForURL(draftPath), viewer.getByRole("button", { name: /^Update/ }).click()]);
    await expect(viewer.getByRole("heading", { name: "Edited third-party draft" })).toBeVisible();
    await setPermissions(editor, "articlemanager", ["ACCESS", "VIEW_PUBLISHED", "PIN_OTHERS", "DELETE_OTHERS"]);
    await viewer.goto(publicPath);
    await expect(viewer.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    await Promise.all([viewer.waitForNavigation(), viewer.getByRole("button", { name: "Pin", exact: true }).click()]);
    await expect(viewer.getByRole("button", { name: "Unpin", exact: true })).toBeVisible();
    expect(await db.collection("document").countDocuments({ title: "Rejected public edit" })).toBe(0);
    await setPermissions(editor, "articlemanager", ["ACCESS", "VIEW_PUBLISHED", "DELETE_OTHERS"]);
    await viewer.goto(publicPath);
    await expect(viewer.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    await Promise.all([
        viewer.waitForURL("/blog/2"),
        viewer.getByRole("button", { name: "Delete", exact: true }).click(),
    ]);
    await resetUser(editor, 3);
});

test("own permissions stay revoked with others grants and role deletion does not revive reused names", async ({
    page,
    editor,
}) => {
    const path = await createPost(page, "Own permission revocation");
    const draft = await createPost(page, "Own draft read revocation", true);
    await createRole(editor, "ownrestricted");
    await setPermissions(editor, "ownrestricted", [
        "ACCESS",
        "VIEW_PUBLISHED",
        "EDIT_OTHERS",
        "DELETE_OTHERS",
        "VIEW_DRAFT_OTHERS",
    ]);
    await assignRole(editor, accounts.author.name, "ownrestricted");
    expect((await page.goto(draft))?.status()).toBe(403);
    await page.goto(path);
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    expect((await page.goto(`${path}/edit`))?.status()).toBe(403);
    const deleted = await page.request.post(`${path}/edit`, {
        headers: { Referer: page.url() },
        form: { operation: "delete" },
    });
    expect(deleted.status()).toBe(403);
    await settingsPage(editor, "/blog/settings/roles");
    const row = editor
        .getByRole("row")
        .filter({ has: editor.getByRole("cell", { name: "ownrestricted", exact: true }) });
    await Promise.all([editor.waitForNavigation(), row.getByRole("button", { name: "Delete" }).click()]);
    await createRole(editor, "ownrestricted");
    await setPermissions(editor, "ownrestricted", []);
    expect((await page.goto(`${path}/edit`))?.status()).toBe(200);
    await settingsPage(editor, "/blog/settings/users");
    await expect(editor.locator('tr[data-uid="2"]')).toHaveCount(0);
});

test("guest policy and domain independence preserve authenticated mutation requirements", async ({
    page,
    editor,
    viewer,
    browser,
    baseURL,
}) => {
    const path = await createPost(page, "Global blog across domains");
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const guest = await context.newPage();
    try {
        await guest.goto("/blog");
        await expect(guest).toHaveURL(/\/login/);
        await setPermissions(editor, "guest", ["ACCESS", "VIEW_PUBLISHED", "STAR", "MANAGE_SETTINGS"]);
        await guest.goto(path);
        await expect(guest.getByRole("heading", { name: "Global blog across domains" })).toBeVisible();
        await expect(guest.locator("[data-star]")).toHaveCount(0);
        await guest.goto("/blog/settings");
        await expect(guest).toHaveURL(/\/login/);
        await viewer.goto(`/d/blogrestricted${path}`);
        await expect(viewer.getByRole("heading", { name: "Global blog across domains" })).toBeVisible();
        await viewer.goto("/d/blogrestricted/p");
        await expect(viewer).not.toHaveURL(/\/blog/);
        await expect(viewer.locator("html")).not.toHaveAttribute("data-page", "problem_main");
        await editor.goto("/d/blogrestricted/blog/settings");
        await expect(editor.locator("html")).toHaveAttribute("data-page", "blog_settings");
    } finally {
        await setPermissions(editor, "guest", []);
        await context.close();
    }
});

test("publishing and unpublishing do not require content-edit permission", async ({ page, editor, viewer }) => {
    const path = await createPost(page, "Independent publication", true);
    await createRole(editor, "publisher");
    await setPermissions(editor, "publisher", [
        "ACCESS",
        "VIEW_PUBLISHED",
        "VIEW_DRAFT_OTHERS",
        "PUBLISH_OTHERS",
        "UNPUBLISH_OTHERS",
    ]);
    await assignRole(editor, accounts.viewer.name, "publisher");
    await viewer.goto(path);
    await expect(viewer.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    await Promise.all([
        viewer.waitForNavigation(),
        viewer.getByRole("button", { name: "Publish", exact: true }).click(),
    ]);
    await expect(viewer.getByRole("button", { name: "Unpublish", exact: true })).toBeVisible();
    await Promise.all([
        viewer.waitForNavigation(),
        viewer.getByRole("button", { name: "Unpublish", exact: true }).click(),
    ]);
    await expect(viewer.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
    await resetUser(editor, 3);
});

test("visible unchecked controls submit false without changing omitted field semantics", async ({ page }) => {
    const path = await createPost(page, "Explicit unchecked draft", true);
    await page.goto(`${path}/edit`);
    await fillPost(page, "Published by unchecked draft", "Explicit checkbox update", false);
    await Promise.all([page.waitForURL(path), page.getByRole("button", { name: /^Update/ }).click()]);
    await expect(page.getByRole("button", { name: "Unpublish", exact: true })).toBeVisible();
});
