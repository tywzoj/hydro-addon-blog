import type { Page } from "@playwright/test";
import type { Udoc } from "hydrooj/src/interface";

import type { BlogPermission } from "../../features/permission";
import type { BlogAssignment, BlogDoc, BlogSettings } from "../../features/types";
import { accounts } from "./accounts";
import { confirmAction, createPost, expect, fillPost, test } from "./fixtures";

async function settingsPage(page: Page, path: string, password = accounts.editor.password) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    if (new URL(page.url()).pathname.endsWith("/user/sudo")) {
        await page.locator('.immersive--content input[name="password"]').fill(password);
        await Promise.all([
            page.waitForURL((url) => !url.pathname.endsWith("/user/sudo"), { waitUntil: "domcontentloaded" }),
            page.locator('input[name="confirm"]').click(),
        ]);
    }
    await expect(page).toHaveURL(new RegExp(`${path}$`));
}

async function createRole(page: Page, name: string) {
    await settingsPage(page, "/blog/settings/roles");
    await page.getByRole("button", { name: "Create Role", exact: true }).click();
    const dialog = page.locator(".dialog:visible");
    await dialog.locator('input[type="text"]').fill(name);
    await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        dialog.locator('[data-action="ok"]').click(),
    ]);
    await expect(page.locator(`.domain-roles tr[data-role="${name}"]`)).toBeVisible();
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
    await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        page.getByRole("button", { name: "Update Permission" }).click(),
    ]);
    await expect(page.locator("html")).toHaveAttribute("data-page", "blog_settings_permissions");
}

async function assignRole(page: Page, name: string, role: string) {
    await settingsPage(page, "/blog/settings/users");
    await page.getByRole("button", { name: "Assign User Roles", exact: true }).click();
    const dialog = page.locator(".dialog:visible");
    await dialog.locator(".autocomplete-wrapper input").fill(name.slice(0, -1));
    await dialog.locator(".user-select__uname").filter({ hasText: name }).click();
    await dialog.locator("select").selectOption(role);
    await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        dialog.locator('[data-action="ok"]').click(),
    ]);
    await expect(page.locator("html")).toHaveAttribute("data-page", "blog_settings_users");
}

async function resetUser(page: Page, uid: number) {
    await settingsPage(page, "/blog/settings/users");
    const row = page.locator(`tr[data-uid="${uid}"]`);
    await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        row.locator('select[name="role"]').selectOption("default"),
    ]);
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
    const initial = (await db.collection<BlogSettings>("blog.settings").findOne({ _id: "global" }))!;
    const configured = (initial.permissionRoleOrder || [])
        .map((id) => initial.roles.find((role) => role.id === id)!.name)
        .filter((name) => name !== "root");
    await createRole(editor, "blogmanager");
    await settingsPage(editor, "/blog/settings/permissions");
    await expect(editor.locator("[data-permission]")).toHaveCount(23);
    await expect(editor.locator('[data-permission="CREATE_OTHERS"]')).toHaveCount(0);
    await expect(editor.locator("thead th.col--p")).toHaveText([
        ...configured,
        "blogmanager",
        ...["guest", "default"].filter((name) => !configured.includes(name)),
        "root",
    ]);
    await setPermissions(editor, "blogmanager", ["ACCESS", "VIEW_PUBLISHED", "MANAGE_SETTINGS"]);
    const savedOrder = [
        ...configured,
        "blogmanager",
        ...["default", "guest"].filter((name) => !configured.includes(name)),
    ];
    await expect(editor.locator("thead th.col--p")).toHaveText([...savedOrder, "root"]);
    await createRole(editor, "matrix_order");
    await settingsPage(editor, "/blog/settings/permissions");
    await expect(editor.locator("thead th.col--p")).toHaveText([...savedOrder, "matrix_order", "root"]);
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
    expect(await db.collection<BlogAssignment>("blog.user").findOne({ _id: 2 })).toMatchObject({ role: "root" });
    await resetUser(viewer, 2);
    await resetUser(editor, 3);
    expect((await viewer.goto("/blog/settings", { waitUntil: "domcontentloaded" }))?.status()).toBe(403);
    await settingsPage(editor, "/blog/settings/users");
    const before = await db
        .collection<BlogAssignment>("blog.user")
        .find({ _id: { $in: [3, 4] } })
        .toArray();
    const invalidAssignments: Record<string, string>[] = [
        { operation: "assign", uid: "3", role: "guest" },
        { operation: "set_users", uids: "3,4", role: "guest" },
    ];
    for (const form of invalidAssignments) {
        const response = await editor.request.post("/blog/settings/users", {
            headers: { Referer: editor.url() },
            form,
        });
        expect(response.status()).toBe(403);
    }
    expect(
        await db
            .collection<BlogAssignment>("blog.user")
            .find({ _id: { $in: [3, 4] } })
            .toArray(),
    ).toEqual(before);
    await expect(editor.locator('tr[data-uid="3"]')).toHaveCount(0);
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
    expect((await viewer.goto(draftPath, { waitUntil: "domcontentloaded" }))?.status()).toBe(403);
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
    await viewer.goto(`${publicPath}/edit`, { waitUntil: "domcontentloaded" });
    const rejected = await viewer.request.post(`${publicPath}/edit`, {
        headers: { Referer: viewer.url() },
        form: { operation: "submit", title: "Rejected public edit", content: "No publish permission", draft: "false" },
    });
    expect(rejected.status()).toBe(403);
    await viewer.goto(`${draftPath}/edit`, { waitUntil: "domcontentloaded" });
    await viewer.locator('input[name="title"]').fill("Edited third-party draft");
    await Promise.all([
        viewer.waitForURL(draftPath, { waitUntil: "domcontentloaded" }),
        viewer.getByRole("button", { name: /^Update/ }).click(),
    ]);
    await expect(viewer.getByRole("heading", { name: "Edited third-party draft" })).toBeVisible();
    await setPermissions(editor, "articlemanager", ["ACCESS", "VIEW_PUBLISHED", "PIN_OTHERS", "DELETE_OTHERS"]);
    await viewer.goto(publicPath, { waitUntil: "domcontentloaded" });
    await expect(viewer.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    await Promise.all([
        viewer.waitForNavigation({ waitUntil: "domcontentloaded" }),
        viewer.getByRole("button", { name: "Pin", exact: true }).click(),
    ]);
    await expect(viewer.getByRole("button", { name: "Unpin", exact: true })).toBeVisible();
    expect(await db.collection("document").countDocuments({ title: "Rejected public edit" })).toBe(0);
    await setPermissions(editor, "articlemanager", ["ACCESS", "VIEW_PUBLISHED", "DELETE_OTHERS"]);
    await viewer.goto(publicPath, { waitUntil: "domcontentloaded" });
    await expect(viewer.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    await Promise.all([
        viewer.waitForURL("/blog/2", { waitUntil: "domcontentloaded" }),
        confirmAction(viewer, viewer.getByRole("button", { name: "Delete", exact: true })),
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
    expect((await page.goto(draft, { waitUntil: "domcontentloaded" }))?.status()).toBe(403);
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    expect((await page.goto(`${path}/edit`, { waitUntil: "domcontentloaded" }))?.status()).toBe(403);
    const deleted = await page.request.post(`${path}/edit`, {
        headers: { Referer: page.url() },
        form: { operation: "delete" },
    });
    expect(deleted.status()).toBe(403);
    await settingsPage(editor, "/blog/settings/roles");
    const row = editor.locator('.domain-roles tr[data-role="ownrestricted"]');
    await row.locator('input[type="checkbox"]').check();
    await editor.getByRole("button", { name: "Delete Selected Roles" }).click();
    await Promise.all([
        editor.waitForNavigation({ waitUntil: "domcontentloaded" }),
        editor.locator('.dialog:visible [data-action="yes"]').click(),
    ]);
    await createRole(editor, "ownrestricted");
    await setPermissions(editor, "ownrestricted", []);
    expect((await page.goto(`${path}/edit`, { waitUntil: "domcontentloaded" }))?.status()).toBe(200);
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
        await guest.goto("/blog", { waitUntil: "domcontentloaded" });
        await expect(guest).toHaveURL(/\/login/);
        await setPermissions(editor, "guest", ["ACCESS", "VIEW_PUBLISHED", "STAR", "MANAGE_SETTINGS"]);
        await guest.goto(path, { waitUntil: "domcontentloaded" });
        await expect(guest.getByRole("heading", { name: "Global blog across domains" })).toBeVisible();
        await expect(guest.locator("[data-star]")).toHaveCount(0);
        await guest.goto("/blog/settings", { waitUntil: "domcontentloaded" });
        await expect(guest).toHaveURL(/\/login/);
        await viewer.goto(`/d/blogrestricted${path}`, { waitUntil: "domcontentloaded" });
        await expect(viewer.getByRole("heading", { name: "Global blog across domains" })).toBeVisible();
        await viewer.goto("/d/blogrestricted/p", { waitUntil: "domcontentloaded" });
        await expect(viewer).not.toHaveURL(/\/blog/);
        await expect(viewer.locator("html")).not.toHaveAttribute("data-page", "problem_main");
        await editor.goto("/d/blogrestricted/blog/settings", { waitUntil: "domcontentloaded" });
        await expect(editor.locator("html")).toHaveAttribute("data-page", "blog_settings");
        await expect(editor.locator("#menu-item-blog_settings .menu__link")).toHaveAttribute("aria-current", "page");
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
    await viewer.goto(path, { waitUntil: "domcontentloaded" });
    await expect(viewer.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    await Promise.all([
        viewer.waitForNavigation({ waitUntil: "domcontentloaded" }),
        confirmAction(viewer, viewer.getByRole("button", { name: "Publish", exact: true })),
    ]);
    await expect(viewer.getByRole("button", { name: "Unpublish", exact: true })).toBeVisible();
    await Promise.all([
        viewer.waitForNavigation({ waitUntil: "domcontentloaded" }),
        confirmAction(viewer, viewer.getByRole("button", { name: "Unpublish", exact: true })),
    ]);
    await expect(viewer.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
    await resetUser(editor, 3);
});

test("visible unchecked controls submit false without changing omitted field semantics", async ({ page }) => {
    const path = await createPost(page, "Explicit unchecked draft", true);
    await page.goto(`${path}/edit`, { waitUntil: "domcontentloaded" });
    await fillPost(page, "Published by unchecked draft", "Explicit checkbox update", false);
    await Promise.all([
        page.waitForURL(path, { waitUntil: "domcontentloaded" }),
        confirmAction(page, page.getByRole("button", { name: /^Update/ })),
    ]);
    await expect(page.getByRole("button", { name: "Unpublish", exact: true })).toBeVisible();
});

test("JSON false and zero publish and unpin while omitted fields remain unchanged", async ({ page, db }) => {
    const posts = db.collection<BlogDoc>("document");
    for (const value of [false, 0]) {
        await page.goto("/blog/2", { waitUntil: "domcontentloaded" });
        const title = `JSON public creation ${value}`;
        const created = await page.request.post("/blog/2/create", {
            headers: { Referer: page.url() },
            data: { operation: "submit", title, content: "Explicit JSON fields", draft: value, pin: value },
        });
        expect(created.ok()).toBe(true);
        expect(await posts.findOne({ title })).toMatchObject({ draft: false, pin: false });

        const draftTitle = `JSON draft update ${value}`;
        const path = await createPost(page, draftTitle, true);
        const update = (data: Record<string, unknown>) =>
            page.request.post(`${path}/edit`, { headers: { Referer: page.url() }, data });
        expect((await update({ operation: "pin", pin: true })).ok()).toBe(true);
        const content = "Omitted flags must be preserved";
        expect((await update({ operation: "submit", title: draftTitle, content })).ok()).toBe(true);
        expect(await posts.findOne({ title: draftTitle })).toMatchObject({ draft: true, pin: true });
        for (const missing of [undefined, null, ""]) {
            expect((await update({ operation: "publish", draft: missing })).status()).toBe(403);
            expect((await update({ operation: "pin", pin: missing })).status()).toBe(403);
        }
        expect(await posts.findOne({ title: draftTitle })).toMatchObject({ draft: true, pin: true });
        expect((await update({ operation: "submit", title: draftTitle, content, draft: value, pin: value })).ok()).toBe(
            true,
        );
        expect(await posts.findOne({ title: draftTitle })).toMatchObject({ draft: false, pin: false });
    }
});

test("delegated managers search global users from restricted domains and role lists deduplicate root", async ({
    editor,
    viewer,
    db,
}) => {
    await createRole(editor, "lookupmanager");
    await setPermissions(editor, "lookupmanager", ["ACCESS", "MANAGE_SETTINGS"]);
    await assignRole(editor, accounts.viewer.name, "lookupmanager");
    await settingsPage(editor, "/blog/settings/users");
    const forcedAssignment = await editor.request.post("/blog/settings/users", {
        headers: { Referer: editor.url() },
        form: { operation: "assign", uid: String(accounts.editor.id), role: "root" },
    });
    expect(forcedAssignment.ok()).toBe(true);
    expect((await viewer.request.get("/d/blogrestricted/p")).status()).toBe(403);
    const lookups: { path: string; args: { search?: string; auto?: string[] } }[] = [];
    viewer.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (path.endsWith("/api/users")) {
            const data = request.postDataJSON() as { args: { search?: string; auto?: string[] } };
            lookups.push({ path, args: data.args });
        }
    });
    // Restore a form value before the native selector attaches, exercising its uncached fetch path.
    await viewer.addInitScript((uid) => {
        document.addEventListener("DOMContentLoaded", () => {
            const input = document.querySelector<HTMLInputElement>('input[name="uids"]');
            if (input) input.value = String(uid);
        });
    }, accounts.author.id);
    await settingsPage(viewer, "/d/blogrestricted/blog/settings/users", accounts.viewer.password);
    await expect
        .poll(() => lookups.some((lookup) => lookup.args.auto?.includes(String(accounts.author.id))))
        .toBe(true);
    await viewer.getByRole("button", { name: "Assign User Roles", exact: true }).click();
    const dialog = viewer.locator(".dialog:visible");
    await dialog.locator(".autocomplete-wrapper input").fill(accounts.author.name);
    await dialog.locator(".user-select__uname").filter({ hasText: accounts.author.name }).click();
    await dialog.locator("select").selectOption("lookupmanager");
    await Promise.all([
        viewer.waitForNavigation({ waitUntil: "domcontentloaded" }),
        dialog.locator('[data-action="ok"]').click(),
    ]);
    await expect(viewer).toHaveURL(/\/d\/blogrestricted\/blog\/settings\/users$/);
    await expect(viewer.locator("#menu-item-blog_settings_users .menu__link")).toHaveAttribute("aria-current", "page");
    await expect(viewer.locator(".domain-users tbody tr[data-uid]")).toHaveCount(3);
    await expect(viewer.locator('tr[data-uid="4"]')).toHaveCount(1);
    await expect(viewer.locator('tr[data-uid="4"] select')).toBeDisabled();
    expect(lookups.some((lookup) => lookup.args.search === accounts.author.name)).toBe(true);
    expect(lookups.some((lookup) => lookup.args.auto?.includes(String(accounts.author.id)))).toBe(true);
    expect(lookups.every((lookup) => lookup.path === "/d/system/api/users")).toBe(true);
    expect(await db.collection<BlogAssignment>("blog.user").countDocuments({ _id: accounts.editor.id })).toBe(1);
    await viewer.goto("/d/blogrestricted/blog/settings/users?page=2", { waitUntil: "domcontentloaded" });
    await expect(viewer.locator(".domain-users tbody tr[data-uid]")).toHaveCount(0);
    await resetUser(editor, accounts.author.id);
    await resetUser(editor, accounts.viewer.id);
});

test("native role controls exclude guest and reset assignments without a remove-user action", async ({
    editor,
    db,
}) => {
    await createRole(editor, "ux_first");
    await createRole(editor, "ux_second");
    await settingsPage(editor, "/blog/settings/users");
    await expect(editor.locator("#menu-item-blog_settings_users .menu__link")).toHaveClass(/active/);
    await expect(editor.locator('.section__tools button[name="add_user"]')).toBeVisible();
    await expect(editor.locator('tr[data-uid="4"] input[type="checkbox"]')).toBeDisabled();
    await expect(editor.locator('tr[data-uid="4"] select')).toBeDisabled();
    await expect(editor.locator('button[name="remove_selected"]')).toHaveCount(0);
    await expect(editor.locator('.main select option[value="guest"]')).toHaveCount(0);

    await editor.locator('button[name="set_roles"]').click();
    await expect(
        editor.getByText("Please select at least one user to perform this operation.", { exact: true }),
    ).toBeVisible();
    await editor.locator('button[name="add_user"]').click();
    let dialog = editor.locator(".dialog:visible");
    await expect(dialog.locator(".autocomplete-wrapper input")).toBeFocused();
    await expect(dialog.locator('select option[value="guest"]')).toHaveCount(0);
    await dialog.locator('[data-action="cancel"]').click();
    expect(await db.collection<BlogAssignment>("blog.user").countDocuments({ _id: { $in: [2, 3] } })).toBe(0);

    await editor.locator('button[name="add_user"]').click();
    dialog = editor.locator(".dialog:visible");
    for (const name of [accounts.author.name, accounts.viewer.name]) {
        await dialog.locator(".autocomplete-wrapper input").fill(name.slice(0, -1));
        await dialog.locator(".user-select__uname").filter({ hasText: name }).click();
    }
    await dialog.locator("select").selectOption("ux_first");
    await Promise.all([
        editor.waitForNavigation({ waitUntil: "domcontentloaded" }),
        dialog.locator('[data-action="ok"]').click(),
    ]);
    await expect(editor.locator('tr[data-uid="2"] select')).toHaveValue("ux_first");
    await expect(editor.locator('tr[data-uid="3"] select')).toHaveValue("ux_first");
    await expect(editor.locator('.domain-users select option[value="guest"]')).toHaveCount(0);

    await editor.locator('tr[data-uid="2"] select').selectOption("ux_second");
    await expect(editor.locator('tr[data-uid="2"]')).toHaveAttribute("data-role", "ux_second");
    await editor.reload({ waitUntil: "domcontentloaded" });
    await expect(editor.locator('tr[data-uid="2"] select')).toHaveValue("ux_second");
    await editor.locator('input[data-checkbox-toggle="user"]').check();
    await expect(editor.locator('tr[data-uid="4"] input[type="checkbox"]')).not.toBeChecked();
    await editor.locator('button[name="set_roles"]').click();
    dialog = editor.locator(".dialog:visible");
    await expect(dialog.locator('select option[value="guest"]')).toHaveCount(0);
    await dialog.locator("select").selectOption("ux_second");
    await Promise.all([
        editor.waitForNavigation({ waitUntil: "domcontentloaded" }),
        dialog.locator('[data-action="ok"]').click(),
    ]);
    await expect(editor.locator('tr[data-uid="3"] select')).toHaveValue("ux_second");

    await editor.locator('input[data-checkbox-toggle="user"]').check();
    await editor.locator('button[name="set_roles"]').click();
    await editor.locator('.dialog:visible [data-action="cancel"]').click();
    await expect(editor.locator('tr[data-uid="2"], tr[data-uid="3"]')).toHaveCount(2);
    await editor.locator('button[name="set_roles"]').click();
    dialog = editor.locator(".dialog:visible");
    await dialog.locator("select").selectOption("default");
    await Promise.all([
        editor.waitForNavigation({ waitUntil: "domcontentloaded" }),
        dialog.locator('[data-action="ok"]').click(),
    ]);
    await expect(editor.locator('tr[data-uid="2"], tr[data-uid="3"]')).toHaveCount(0);
    expect(await db.collection<Udoc>("user").countDocuments({ _id: { $in: [2, 3] } })).toBe(2);
});

test("fresh sudo from a restricted domain uses the global authentication entry and returns to settings", async ({
    browser,
    baseURL,
}) => {
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
        const page = await context.newPage();
        await page.goto("/login", { waitUntil: "domcontentloaded" });
        await page.locator('.immersive--content input[name="uname"]').fill(accounts.editor.name);
        await page.locator('.immersive--content input[name="password"]').fill(accounts.editor.password);
        await Promise.all([
            page.waitForURL("/", { waitUntil: "domcontentloaded" }),
            page.locator('.immersive--content input[name="login_submit"]').click(),
        ]);
        await page.goto("/d/blogrestricted/blog/settings/users", { waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(`${baseURL}/user/sudo`);
        await page.locator('.immersive--content input[name="password"]').fill(accounts.editor.password);
        await Promise.all([
            page.waitForURL("/d/blogrestricted/blog/settings/users", { waitUntil: "domcontentloaded" }),
            page.locator('input[name="confirm"]').click(),
        ]);
        await expect(page.locator("html")).toHaveAttribute("data-page", "blog_settings_users");
        await expect(page.locator("#menu-item-blog_settings_users .menu__link")).toHaveAttribute(
            "aria-current",
            "page",
        );
    } finally {
        await context.close();
    }
});
