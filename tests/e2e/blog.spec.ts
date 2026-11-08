import { ObjectId } from "mongodb";

import { BlogConfirmMessages, ReviewMessages } from "../../features/shared/constants";
import type { BlogDoc, BlogStatusDoc } from "../../features/shared/types";
import { blogState, confirmAction, createPost, expect, fillPost, submitPost, test } from "./fixtures";

test("blog pagination preserves selected sorting on home and user lists", async ({ page, viewer }) => {
    await page.goto("/blog/2", { waitUntil: "domcontentloaded" });
    for (let index = 0; index < 11; index++) {
        const response = await page.request.post("/blog/2/create", {
            headers: { Referer: page.url(), Accept: "application/json" },
            form: {
                operation: "submit",
                title: `Pagination post ${index}`,
                content: "Pagination fixture",
                draft: "false",
            },
        });
        expect(response.ok(), await response.text()).toBe(true);
    }
    for (const path of ["/blog", "/blog/2", "/d/blogrestricted/blog", "/d/blogrestricted/blog/2"]) {
        for (const sort of ["views", "latest", "latest_update"]) {
            await viewer.goto(`${path}?sort=${sort}`, { waitUntil: "domcontentloaded" });
            await expect(viewer.locator("#blog-list-sort")).toHaveValue(sort);
            await viewer.locator(".pager__item.next").click();
            await expect(viewer).toHaveURL((url) => url.pathname === path && url.searchParams.get("page") === "2");
            expect(new URL(viewer.url()).searchParams.get("sort")).toBe(sort);
            await expect(viewer.locator("#blog-list-sort")).toHaveValue(sort);
            await viewer.locator(".pager__item.previous").click();
            await expect(viewer).toHaveURL(
                (url) =>
                    url.pathname === path &&
                    url.searchParams.get("page") === "1" &&
                    url.searchParams.get("sort") === sort,
            );
        }
    }
    await viewer.goto("/blog/2?page=2&sort=views", { waitUntil: "domcontentloaded" });
    await viewer.locator("#blog-list-sort").selectOption("latest");
    await expect(viewer).toHaveURL(
        (url) =>
            url.pathname === "/blog/2" && url.searchParams.get("sort") === "latest" && !url.searchParams.has("page"),
    );
});

test("article JSON responses omit IPs for readers, authors and root while preserving storage", async ({
    page,
    viewer,
    editor,
    db,
}) => {
    const path = await createPost(page, "Article IP privacy");
    const docId = new ObjectId(path.split("/").pop()!);
    const posts = db.collection<BlogDoc>("document");
    const stored = (await posts.findOne({ docType: 70, docId }))!;
    expect(stored.ip).toEqual(expect.any(String));
    for (const reader of [page, viewer, editor]) {
        for (const prefix of ["", "/d/blogrestricted"]) {
            for (const target of ["/blog", "/blog/2", path, ...(reader === viewer ? [] : [`${path}/edit`])]) {
                const response = await reader.request.get(`${prefix}${target}`, {
                    headers: { Accept: "application/json" },
                });
                expect(response.ok(), await response.text()).toBe(true);
                const body = (await response.json()) as { ddoc?: BlogDoc; ddocs?: BlogDoc[] };
                const doc = body.ddoc ?? body.ddocs?.find((entry) => entry.docId.toString() === docId.toHexString());
                expect(doc).toMatchObject({ title: "Article IP privacy" });
                expect(doc).not.toHaveProperty("ip");
            }
        }
    }
    expect((await posts.findOne({ docType: 70, docId }))?.ip).toBe(stored.ip);
    const pinned = await editor.request.post(`${path}/edit`, {
        headers: { Referer: page.url(), Accept: "application/json" },
        form: { operation: "pin", pin: "true" },
    });
    expect(pinned.ok(), await pinned.text()).toBe(true);
    const updated = (await posts.findOne({ docType: 70, docId }))!;
    expect(updated).toMatchObject({ pin: true, ip: expect.any(String) });
    const editAudit = await db.collection("oplog").findOne({ type: "blog.edit", docId });
    expect(editAudit).toMatchObject({ ip: stored.ip, operateIp: expect.any(String) });
    const response = await page.request.get(path, { headers: { Accept: "application/json" } });
    expect(await response.json()).not.toHaveProperty("ddoc.ip");
});

test("draft publication and edits persist across real author and viewer sessions", async ({ page, viewer, db }) => {
    const title = "E2E draft publication";
    const path = await createPost(page, title, true);
    const actions = page.locator(".medium-3.columns [data-blog-actions]");
    await expect(
        page.locator(".medium-3.columns > .section.side").first().locator(".sidebar-user-profile"),
    ).toBeVisible();
    await expect(page.locator(".medium-3.columns > .section.side").nth(1)).toHaveAttribute("data-blog-actions", "");
    await expect(actions.getByRole("button")).toHaveText(["Publish", "Pin", "Delete"]);
    await expect(actions.locator(".icon")).toHaveCount(0);
    await expect(actions.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
    await expect(page.locator(".medium-9.columns button[name='operation']")).toHaveCount(0);
    await expect(page.locator("#blog-review-comments")).toHaveCount(0);
    await expect(page.locator(".section__footer")).not.toContainText("Rejections:");
    const docId = new ObjectId(path.split("/").pop()!);
    const posts = db.collection<BlogDoc>("document");
    expect(await posts.findOne({ docId })).not.toHaveProperty("firstPublishAt");
    await page.goto("/blog/2", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
    await viewer.goto("/blog/2", { waitUntil: "domcontentloaded" });
    await expect(viewer.getByRole("link", { name: title, exact: true })).toHaveCount(0);
    await page.goto("/blog", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);

    await page.goto(`${path}/edit`, { waitUntil: "domcontentloaded" });
    await fillPost(page, title, "Published through the real editor", false);
    await submitPost(page);
    const published = await posts.findOne({ docId });
    expect(published?.firstPublishAt).toBeInstanceOf(Date);
    await viewer.goto("/blog/2", { waitUntil: "domcontentloaded" });
    await expect(viewer.getByRole("link", { name: title, exact: true })).toBeVisible();
    await viewer.goto(path, { waitUntil: "domcontentloaded" });
    await expect(viewer.locator("[data-blog-actions]")).toHaveCount(0);
    await expect(viewer.locator(".section__footer")).not.toContainText("Rejections:");

    await page.goto(`${path}/edit`, { waitUntil: "domcontentloaded" });
    await fillPost(page, `${title} edited`, "Persisted edited content", false);
    await submitPost(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: `${title} edited`, exact: true })).toBeVisible();
    await expect(page.locator(".topic__content")).toContainText("Persisted edited content");
    await expect(actions.getByRole("button")).toHaveText(["Unpublish", "Pin", "Delete"]);
    await expect(actions.getByRole("button", { name: "Unpublish", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(actions.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect((await posts.findOne({ docId }))?.firstPublishAt).toEqual(published?.firstPublishAt);
});

test("a non-owner cannot create, edit, or delete another user's posts", async ({ page, viewer, db }) => {
    const title = "E2E protected post";
    const path = await createPost(page, title);
    const docId = new ObjectId(path.split("/").pop()!);
    const sentinel = await createPost(page, "E2E unrelated protected post");
    const thread = await page.request.post(path, {
        headers: { Referer: page.url(), Accept: "application/json" },
        data: { operation: "reply", content: "Protected article thread" },
    });
    expect(thread.ok(), await thread.text()).toBe(true);
    const { drid } = (await thread.json()) as { drid: string };
    const before = await blogState(db, [path, sentinel]);
    await viewer.goto("/blog/2", { waitUntil: "domcontentloaded" });
    for (const target of ["/blog/2/create", `${path}/edit`]) {
        const response = await viewer.goto(target, { waitUntil: "domcontentloaded" });
        expect(response?.status()).toBe(403);
    }
    for (const operation of ["submit", "delete", "pin", "publish"]) {
        const response = await viewer.request.post(`${path}/edit?uid=3&did=${sentinel.split("/").pop()!}`, {
            headers: { Referer: viewer.url() },
            data: {
                operation,
                title: "Unauthorized mutation",
                content: "Rejected body",
                draft: false,
                pin: true,
                uid: 3,
                owner: 3,
                did: sentinel.split("/").pop()!,
                role: "root",
            },
        });
        expect(response.status()).toBe(403);
        expect(await blogState(db, [path, sentinel])).toEqual(before);
    }
    const creation = await viewer.request.post("/blog/2/create", {
        headers: { Referer: viewer.url() },
        data: { operation: "submit", title: "Unauthorized creation", content: "Rejected body", uid: 3, owner: 3 },
    });
    expect(creation.status()).toBe(403);
    const commentDeletion = await viewer.request.post(path, {
        headers: { Referer: viewer.url() },
        data: { operation: "delete_reply", drid, owner: 3 },
    });
    expect(commentDeletion.status()).toBe(403);
    const mismatchedAuthor = await page.request.post(`/blog/3/${docId.toHexString()}/edit`, {
        headers: { Referer: page.url() },
        data: { operation: "delete", uid: 2 },
    });
    expect(mismatchedAuthor.ok()).toBe(false);
    expect(await blogState(db, [path, sentinel])).toEqual(before);
    const posts = db.collection<BlogDoc>("document");
    expect((await posts.findOne({ docId }))?.title).toBe(title);
    expect(await posts.countDocuments({ title: "Unauthorized creation" })).toBe(0);
    const permitted = await page.request.post(`${path}/edit`, {
        headers: { Referer: page.url() },
        data: { operation: "pin", pin: true },
    });
    expect(permitted.ok(), await permitted.text()).toBe(true);
    expect(await posts.findOne({ docId })).toMatchObject({ pin: true });
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
});

test("a real system editor sees drafts in the author's list and can edit them", async ({ page, editor, viewer }) => {
    const title = "E2E editor draft";
    const path = await createPost(page, title, true);
    await editor.goto("/blog/2", { waitUntil: "domcontentloaded" });
    await expect(editor.getByRole("link", { name: title, exact: true })).toBeVisible();
    await editor.goto("/blog", { waitUntil: "domcontentloaded" });
    await expect(editor.getByRole("link", { name: title, exact: true })).toHaveCount(0);
    await editor.goto(`${path}/edit`, { waitUntil: "domcontentloaded" });
    await fillPost(editor, "E2E editor published", "Changed by a system editor", false);
    await submitPost(editor);
    await viewer.goto("/blog/2", { waitUntil: "domcontentloaded" });
    await expect(viewer.getByRole("link", { name: "E2E editor published", exact: true })).toBeVisible();
});

test("even root can only create articles under its own account", async ({ editor, db }) => {
    await editor.goto("/blog/2", { waitUntil: "domcontentloaded" });
    await expect(editor.locator('a[href="/blog/2/create"]')).toHaveCount(0);
    const posts = db.collection<BlogDoc>("document");
    const title = "E2E root creation ownership";
    for (const path of ["/blog/2/create", "/d/blogrestricted/blog/2/create"]) {
        expect((await editor.goto(path, { waitUntil: "domcontentloaded" }))?.status()).toBe(403);
        const response = await editor.request.post(path, {
            headers: { Referer: editor.url() },
            form: { operation: "submit", title, content: "Must not be attributed to another user" },
        });
        expect(response.status()).toBe(403);
    }
    expect(await posts.countDocuments({ title })).toBe(0);

    await editor.goto("/blog/4", { waitUntil: "domcontentloaded" });
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
    await viewer.goto(path, { waitUntil: "domcontentloaded" });
    const first = (await posts.findOne({ docId }))!.views;
    expect(first).toBe(initial + 1);
    await viewer.reload({ waitUntil: "domcontentloaded" });
    expect((await posts.findOne({ docId }))!.views).toBe(first);
    await viewer.locator("[data-star] button.star").click();
    await expect.poll(async () => (await statuses.findOne({ docId, uid: 3 }))?.star).toBe(true);
    await viewer.reload({ waitUntil: "domcontentloaded" });
    await expect(viewer.locator("[data-star]")).toHaveAttribute("data-star", "true");
    expect((await statuses.findOne({ docId, uid: 2 }))?.star).not.toBe(true);
    await viewer.locator("[data-star] button.star").click();
    await expect.poll(async () => (await statuses.findOne({ docId, uid: 3 }))?.star).toBe(false);
    await viewer.reload({ waitUntil: "domcontentloaded" });
    await expect(viewer.locator("[data-star]")).toHaveAttribute("data-star", "false");
});

test("deletion removes the persisted post and user statuses", async ({ page, viewer, db }) => {
    const path = await createPost(page, "E2E disposable deletion");
    const docId = new ObjectId(path.split("/").pop()!);
    await viewer.goto(path, { waitUntil: "domcontentloaded" });
    expect(await db.collection("document.status").countDocuments({ docId })).toBeGreaterThan(0);
    await page.goto(`${path}/edit`, { waitUntil: "domcontentloaded" });
    await page.locator('button[name="operation"][value="delete"]').click();
    await expect(page.locator(".dialog:visible")).toContainText("This cannot be undone.");
    await page.locator('.dialog:visible [data-action="no"]').click();
    await expect(page.locator(".dialog:visible")).toHaveCount(0);
    expect(await db.collection("document").countDocuments({ docId })).toBe(1);
    await expect(page.locator('input[name="title"]')).toHaveValue("E2E disposable deletion");
    await Promise.all([
        page.waitForURL((url) => url.pathname === "/blog/2", { waitUntil: "domcontentloaded" }),
        confirmAction(page, page.locator('button[name="operation"][value="delete"]')),
    ]);
    expect(await db.collection("document").countDocuments({ docId })).toBe(0);
    expect(await db.collection("document.status").countDocuments({ docId })).toBe(0);
});

test("critical action dialogs cancel writes and preserve editor hotkey submission", async ({ page, db }) => {
    const path = await createPost(page, "Confirmation draft", true);
    const docId = new ObjectId(path.split("/").pop()!);
    const posts = db.collection<BlogDoc>("document");
    const writes: string[] = [];
    page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname === `${path}/edit`) {
            writes.push(request.postData()!);
        }
    });
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.locator(".dialog:visible")).toContainText("Publish this article?");
    expect(writes).toHaveLength(0);
    await page.locator('.dialog:visible [data-action="no"]').click();
    await expect(page.locator(".dialog:visible")).toHaveCount(0);
    expect((await posts.findOne({ docId }))?.draft).toBe(true);

    await page.goto(`${path}/edit`, { waitUntil: "domcontentloaded" });
    await fillPost(page, "Confirmed hotkey publication", "Content retained after cancellation", false);
    for (const shortcut of ["Control+Enter", "Meta+Enter"]) {
        await page.locator(".cm-content[contenteditable=true]").press(shortcut);
        await expect(page.locator(".dialog:visible")).toContainText("Publish this article?");
        await page.locator('.dialog:visible [data-action="no"]').click();
        await expect(page.locator(".dialog:visible")).toHaveCount(0);
        expect(writes).toHaveLength(0);
        await expect(page.locator('textarea[name="content"]')).toHaveValue("Content retained after cancellation");
    }
    await page.locator(".cm-content[contenteditable=true]").press("Control+Enter");
    await Promise.all([
        page.waitForURL(path, { waitUntil: "domcontentloaded" }),
        page.locator('.dialog:visible [data-action="yes"]').click(),
    ]);
    expect(writes).toHaveLength(1);
    expect(new URLSearchParams(writes[0]).get("operation")).toBe("submit");
    expect(await posts.findOne({ docId })).toMatchObject({
        draft: false,
        title: "Confirmed hotkey publication",
        content: "Content retained after cancellation",
    });

    await page.goto(`${path}/edit`, { waitUntil: "domcontentloaded" });
    await page.locator('input[name="draft"]').check();
    await page.getByRole("button", { name: /^Update/ }).click();
    await expect(page.locator(".dialog:visible")).toContainText("Unpublish this article?");
    await page.locator('.dialog:visible [data-action="no"]').click();
    await expect(page.locator(".dialog:visible")).toHaveCount(0);
    expect(writes).toHaveLength(1);
    expect((await posts.findOne({ docId }))?.draft).toBe(false);
    await submitPost(page);
    expect(writes).toHaveLength(2);
    expect((await posts.findOne({ docId }))?.draft).toBe(true);
});

for (const [language, publishMessage, deleteMessage] of [
    ["zh", "确认发布这篇文章？", "确认删除这篇文章及其全部评论？此操作无法撤销。"],
    ["zh_TW", "確定發布這篇文章？", "確定刪除這篇文章及其全部評論？此操作無法復原。"],
    ["ko", "이 게시물을 게시할까요?", "이 게시물과 모든 댓글을 삭제할까요? 이 작업은 되돌릴 수 없습니다."],
]) {
    test(`confirmation dialogs localize with a stale catalog: ${language}`, async ({ page, db }) => {
        async function setLanguage(value: string) {
            await page.goto("/home/settings/preference", { waitUntil: "domcontentloaded" });
            await page.locator('select[name="viewLang"]').selectOption(value);
            await Promise.all([
                page.waitForNavigation({ waitUntil: "domcontentloaded" }),
                page.locator('input.primary[type="submit"]').click(),
            ]);
        }
        async function removeCachedConfirmations() {
            await page.evaluate(
                (keys) => {
                    const catalog = (window as typeof window & { LOCALES: Record<string, string> }).LOCALES;
                    for (const key of keys) delete catalog[key];
                },
                [...Object.values(BlogConfirmMessages), ReviewMessages.ResetConfirm],
            );
        }
        try {
            await setLanguage(language);
            const path = await createPost(page, `Localized confirmation ${language}`, true);
            await removeCachedConfirmations();
            await page.locator('button[name="operation"][value="publish"]').click();
            await expect(page.locator(".dialog:visible .dialog__body")).toHaveText(publishMessage);
            await page.locator('.dialog:visible [data-action="no"]').click();
            await expect(page.locator(".dialog:visible")).toHaveCount(0);

            await page.goto(`${path}/edit`, { waitUntil: "domcontentloaded" });
            await expect(page.locator(".cm-content[contenteditable=true]")).toBeVisible();
            await removeCachedConfirmations();
            await page.locator('button[name="operation"][value="delete"]').click();
            await expect(page.locator(".dialog:visible .dialog__body")).toHaveText(deleteMessage);
            await page.locator('.dialog:visible [data-action="no"]').click();
            await expect(page.locator(".dialog:visible")).toHaveCount(0);
            expect(
                await db.collection("document").findOne({ docId: new ObjectId(path.split("/").pop()!) }),
            ).toMatchObject({ draft: true, title: `Localized confirmation ${language}` });
        } finally {
            await setLanguage("en");
        }
    });
}

test("the addon frontend adds a working blog link to the real user profile", async ({ page }) => {
    await page.goto("/user/2", { waitUntil: "domcontentloaded" });
    const link = page.locator('a.profile-header__contact-item[href="/blog/2"]');
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/blog\/2$/);
    await expect(page.locator("html")).toHaveAttribute("data-page", "blog_main");
});
