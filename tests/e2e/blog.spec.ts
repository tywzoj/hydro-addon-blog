import { ObjectId } from "mongodb";

import type { BlogDoc, BlogStatusDoc } from "../../features/types";
import { createPost, expect, fillPost, submitPost, test } from "./fixtures";

test("draft publication and edits persist across real author and viewer sessions", async ({ page, viewer, db }) => {
    const title = "E2E draft publication";
    const path = await createPost(page, title, true);
    const docId = new ObjectId(path.split("/").pop()!);
    const posts = db.collection<BlogDoc>("document");
    expect(await posts.findOne({ docId })).not.toHaveProperty("firstPublishAt");
    await page.goto("/blog/2");
    await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
    await viewer.goto("/blog/2");
    await expect(viewer.getByRole("link", { name: title, exact: true })).toHaveCount(0);
    await page.goto("/blog");
    await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);

    await page.goto(`${path}/edit`);
    await fillPost(page, title, "Published through the real editor", false);
    await submitPost(page);
    const published = await posts.findOne({ docId });
    expect(published?.firstPublishAt).toBeInstanceOf(Date);
    await viewer.goto("/blog/2");
    await expect(viewer.getByRole("link", { name: title, exact: true })).toBeVisible();

    await page.goto(`${path}/edit`);
    await fillPost(page, `${title} edited`, "Persisted edited content", false);
    await submitPost(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: `${title} edited`, exact: true })).toBeVisible();
    await expect(page.locator(".topic__content")).toContainText("Persisted edited content");
    expect((await posts.findOne({ docId }))?.firstPublishAt).toEqual(published?.firstPublishAt);
});

test("a non-owner cannot create, edit, or delete another user's posts", async ({ page, viewer, db }) => {
    const title = "E2E protected post";
    const path = await createPost(page, title);
    const docId = new ObjectId(path.split("/").pop()!);
    await viewer.goto("/blog/2");
    for (const target of ["/blog/2/create", `${path}/edit`]) {
        const response = await viewer.goto(target);
        expect(response?.status()).toBe(403);
    }
    for (const operation of ["submit", "delete"]) {
        const response = await viewer.request.post(`${path}/edit`, {
            headers: { Referer: viewer.url() },
            form: { operation, title: "Unauthorized mutation", content: "Rejected body", draft: "false", pin: "false" },
        });
        expect(response.status()).toBe(403);
    }
    const creation = await viewer.request.post("/blog/2/create", {
        headers: { Referer: viewer.url() },
        form: { operation: "submit", title: "Unauthorized creation", content: "Rejected body" },
    });
    expect(creation.status()).toBe(403);
    const posts = db.collection<BlogDoc>("document");
    expect((await posts.findOne({ docId }))?.title).toBe(title);
    expect(await posts.countDocuments({ title: "Unauthorized creation" })).toBe(0);
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
});

test("a real system editor sees drafts in the author's list and can edit them", async ({ page, editor, viewer }) => {
    const title = "E2E editor draft";
    const path = await createPost(page, title, true);
    await editor.goto("/blog/2");
    await expect(editor.getByRole("link", { name: title, exact: true })).toBeVisible();
    await editor.goto("/blog");
    await expect(editor.getByRole("link", { name: title, exact: true })).toHaveCount(0);
    await editor.goto(`${path}/edit`);
    await fillPost(editor, "E2E editor published", "Changed by a system editor", false);
    await submitPost(editor);
    await viewer.goto("/blog/2");
    await expect(viewer.getByRole("link", { name: "E2E editor published", exact: true })).toBeVisible();
});

test("even root can only create articles under its own account", async ({ editor, db }) => {
    await editor.goto("/blog/2");
    await expect(editor.locator('a[href="/blog/2/create"]')).toHaveCount(0);
    const posts = db.collection<BlogDoc>("document");
    const title = "E2E root creation ownership";
    for (const path of ["/blog/2/create", "/d/blogrestricted/blog/2/create"]) {
        expect((await editor.goto(path))?.status()).toBe(403);
        const response = await editor.request.post(path, {
            headers: { Referer: editor.url() },
            form: { operation: "submit", title, content: "Must not be attributed to another user" },
        });
        expect(response.status()).toBe(403);
    }
    expect(await posts.countDocuments({ title })).toBe(0);

    await editor.goto("/blog/4");
    await expect(editor.locator('a[href="/blog/4/create"]')).toBeVisible();
    await editor.locator('a[href="/blog/4/create"]').click();
    await fillPost(editor, title, "Written by the signed-in system editor", true);
    await submitPost(editor);
    expect(await posts.findOne({ title })).toMatchObject({ owner: 4, draft: true });
});

test("sequential views and star state persist independently for each user", async ({ page, viewer, db }) => {
    const path = await createPost(page, "E2E views and star");
    const docId = new ObjectId(path.split("/").pop()!);
    const posts = db.collection<BlogDoc>("document");
    const statuses = db.collection<BlogStatusDoc & { uid: number }>("document.status");
    const initial = (await posts.findOne({ docId }))!.views;
    await viewer.goto(path);
    const first = (await posts.findOne({ docId }))!.views;
    expect(first).toBe(initial + 1);
    await viewer.reload();
    expect((await posts.findOne({ docId }))!.views).toBe(first);
    await viewer.locator("[data-star] button.star").click();
    await expect.poll(async () => (await statuses.findOne({ docId, uid: 3 }))?.star).toBe(true);
    await viewer.reload();
    await expect(viewer.locator("[data-star]")).toHaveAttribute("data-star", "true");
    expect((await statuses.findOne({ docId, uid: 2 }))?.star).not.toBe(true);
    await viewer.locator("[data-star] button.star").click();
    await expect.poll(async () => (await statuses.findOne({ docId, uid: 3 }))?.star).toBe(false);
    await viewer.reload();
    await expect(viewer.locator("[data-star]")).toHaveAttribute("data-star", "false");
});

test("deletion removes the persisted post and user statuses", async ({ page, viewer, db }) => {
    const path = await createPost(page, "E2E disposable deletion");
    const docId = new ObjectId(path.split("/").pop()!);
    await viewer.goto(path);
    expect(await db.collection("document.status").countDocuments({ docId })).toBeGreaterThan(0);
    await page.goto(`${path}/edit`);
    await Promise.all([
        page.waitForURL((url) => url.pathname === "/blog/2"),
        page.locator('button[name="operation"][value="delete"]').click(),
    ]);
    expect(await db.collection("document").countDocuments({ docId })).toBe(0);
    expect(await db.collection("document.status").countDocuments({ docId })).toBe(0);
});

test("the addon frontend adds a working blog link to the real user profile", async ({ page }) => {
    await page.goto("/user/2");
    const link = page.locator('a.profile-header__contact-item[href="/blog/2"]');
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/blog\/2$/);
    await expect(page.locator("html")).toHaveAttribute("data-page", "blog_main");
});
