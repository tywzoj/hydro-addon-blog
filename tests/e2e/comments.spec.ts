import type { Locator, Page } from "@playwright/test";
import { ObjectId } from "mongodb";

import type { BlogCommentDoc, BlogDoc } from "../../features/types";
import { accounts } from "./accounts";
import { createPost, expect, test } from "./fixtures";

async function post(page: Page, path: string, data: Record<string, string | boolean | number | undefined>) {
    return page.request.post(path, {
        headers: { Referer: new URL(path, process.env.HYDRO_E2E_URL).href, Accept: "application/json" },
        data,
    });
}

async function addComment(page: Page, path: string, content: string, drid?: string) {
    const response = await post(page, path, {
        operation: drid ? "tail_reply" : "reply",
        content,
        ...(drid ? { drid } : {}),
    });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()) as { drid?: string; drrid?: string };
}

async function submitComment(page: Page, content: string) {
    const form = page.locator(".dczcomments__box:visible");
    await form.locator(".cm-content[contenteditable=true]").fill(content);
    await expect(form.locator('textarea[name="content"]')).toHaveValue(content);
    await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        form.locator('input[type="submit"]').click(),
    ]);
}

async function deleteWithConfirmation(page: Page, control: Locator, confirm: boolean) {
    await control.click();
    const dialog = page.locator(".dialog:visible");
    const button = dialog.locator(`[data-action="${confirm ? "yes" : "no"}"]`);
    await expect(button).toBeVisible();
    // Native dialogs ignore closing while their opening transition is in progress.
    await dialog.locator(".dialog__content").evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    if (confirm) await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), button.click()]);
    else {
        await button.click();
        await expect(dialog).toHaveCount(0);
    }
}

const commentGrants = ["CREATE_COMMENT", "DELETE_COMMENT_OWN", "DELETE_COMMENT", "DELETE_COMMENT_IN_OWN_POST"];
const defaultGrants = ["CREATE_COMMENT", "DELETE_COMMENT_OWN", "DELETE_COMMENT_IN_OWN_POST"];

async function setCommentGrants(editor: Page, grants: string[], role = "default") {
    await editor.goto("/blog/settings/permissions", { waitUntil: "domcontentloaded" });
    if (new URL(editor.url()).pathname.endsWith("/user/sudo")) {
        await editor.locator('.immersive--content input[name="password"]').fill(accounts.editor.password);
        await Promise.all([
            editor.waitForURL((url) => !url.pathname.endsWith("/user/sudo"), { waitUntil: "domcontentloaded" }),
            editor.locator('input[name="confirm"]').click(),
        ]);
    }
    for (const grant of role === "guest" ? ["ACCESS", "VIEW_PUBLISHED", ...commentGrants] : commentGrants) {
        await editor
            .locator(`[data-permission="${grant}"] input[data-role="${role}"]`)
            .setChecked(grants.includes(grant));
    }
    await Promise.all([
        editor.waitForNavigation({ waitUntil: "domcontentloaded" }),
        editor.getByRole("button", { name: "Update Permission" }).click(),
    ]);
}

test("comments use the native editor and both levels support reversible likes after replies", async ({
    page,
    viewer,
    editor,
    db,
}) => {
    const path = await createPost(page, "Comments native interaction");
    const did = new ObjectId(path.split("/").pop()!);
    const before = await db.collection<BlogDoc>("document").findOne({ docId: did });
    await viewer.goto(path, { waitUntil: "domcontentloaded" });
    await viewer.locator('[name="dczcomments__dummy-box"]').click();
    await submitComment(viewer, "**Comment Markdown** @[](/user/2)");
    const stored = await db.collection<BlogCommentDoc>("document").findOne({ parentId: did, docType: 71 });
    expect(stored?.owner).toBe(3);
    const drid = stored!.docId.toHexString();
    const top = viewer.locator(`[data-comment-id="${drid}"]`);
    await expect(top.locator("strong")).toHaveText("Comment Markdown");
    await top.locator('[data-op="reply"][data-type="comment"]').click();
    await submitComment(viewer, "Nested reply");
    const withReply = await db.collection<BlogCommentDoc>("document").findOne({ docId: stored!.docId });
    const drrid = withReply!.reply![0]._id.toHexString();
    const topLike = viewer.locator(`[data-blog-like][data-drid="${drid}"][data-drrid=""]`);
    const tailLike = viewer.locator(`[data-blog-like][data-drrid="${drrid}"]`);
    for (const control of [topLike, tailLike]) {
        await control.click();
        await expect(control).toHaveAttribute("aria-pressed", "true");
        await expect(control.locator("[data-like-count]")).toHaveText("1");
    }
    await viewer.reload({ waitUntil: "domcontentloaded" });
    await expect(topLike).toHaveAttribute("aria-pressed", "true");
    await expect(tailLike).toHaveAttribute("aria-pressed", "true");
    await tailLike.click();
    await expect(tailLike).toHaveAttribute("aria-pressed", "false");
    await expect(tailLike.locator("[data-like-count]")).toHaveText("0");

    await viewer.locator(`[data-reply-id="${drrid}"] [data-op="reply"]`).click();
    await expect(viewer.locator('.dczcomments__box:visible textarea[name="content"]')).toHaveValue(
        /@\[\]\(\/user\/3\)/,
    );
    await submitComment(viewer, "Reply to an already replied-to comment");
    await expect(viewer.locator(`[data-comment-id="${drid}"] [data-reply-id]`)).toHaveCount(2);
    await expect(topLike).toBeEnabled();
    const after = await db.collection<BlogDoc>("document").findOne({ docId: did });
    expect(after?.updateAt).toEqual(before?.updateAt);
    expect(after?.firstPublishAt).toEqual(before?.firstPublishAt);
    expect(after).not.toHaveProperty("commentUpdatedAt");
    expect(after?.nReply).toBe(1);
    expect(
        await db.collection("message").countDocuments({ to: 2, content: { $regex: "mentioned you" } }),
    ).toBeGreaterThan(0);
    await expect(
        viewer.locator('#blog-comments [data-op="edit"], #blog-comments [data-op="react"], [data-discussion-history]'),
    ).toHaveCount(0);

    await editor.goto(path, { waitUntil: "domcontentloaded" });
    const remove = editor.locator(`[data-reply-id="${drrid}"] [data-op="delete"]`);
    await deleteWithConfirmation(editor, remove, false);
    expect((await db.collection<BlogCommentDoc>("document").findOne({ docId: stored!.docId }))?.reply).toHaveLength(2);
    await deleteWithConfirmation(editor, remove, true);
    expect(await db.collection("document.status").countDocuments({ docType: 71, docId: new ObjectId(drrid) })).toBe(0);
    expect(
        await db.collection("message").countDocuments({ to: 3, content: { $regex: "deleted your blog reply" } }),
    ).toBeGreaterThan(0);
});

test("comments validate target chains and remain immutable with draft likes disabled", async ({
    page,
    viewer,
    editor,
    db,
}) => {
    const path = await createPost(page, "Comments target binding");
    await viewer.goto(path, { waitUntil: "domcontentloaded" });
    const { drid } = await addComment(viewer, path, "Original comment");
    const { drrid } = await addComment(viewer, path, "Original reply", drid);
    const other = await createPost(page, "Other comments article");
    for (const data of [
        { operation: "tail_reply", drid: drid!, content: "Wrong article" },
        { operation: "delete_reply", drid: drid! },
        { operation: "delete_tail_reply", drid: drid!, drrid: drrid! },
        { operation: "like", drid: drid!, drrid: drrid!, liked: true },
    ]) {
        expect((await post(editor, other, data)).ok()).toBe(false);
    }
    const second = await addComment(viewer, path, "Second top");
    expect((await post(editor, path, { operation: "delete_tail_reply", drid: second.drid!, drrid: drrid! })).ok()).toBe(
        false,
    );
    for (const operation of ["edit_reply", "edit_tail_reply", "set_lock", "reaction"]) {
        expect(
            (
                await post(editor, path, {
                    operation,
                    drid: drid!,
                    drrid: drrid!,
                    content: "Must not edit",
                    lock: true,
                    emoji: "x",
                })
            ).ok(),
        ).toBe(false);
    }
    expect((await editor.request.get(`${path}/${drid}/raw`)).ok()).toBe(false);
    expect((await post(page, `${path}/edit`, { operation: "publish", draft: true })).ok()).toBe(true);
    expect((await viewer.goto(path, { waitUntil: "domcontentloaded" }))?.status()).toBe(403);
    for (const liked of [true, false]) {
        expect((await post(editor, path, { operation: "like", drid: drid!, drrid: drrid!, liked })).status()).toBe(403);
    }
    expect((await post(editor, path, { operation: "reply", content: "Draft comment" })).status()).toBe(403);
    await editor.goto(path, { waitUntil: "domcontentloaded" });
    await expect(editor.locator("[data-blog-like]")).toHaveCount(0);
    await expect(editor.locator("#blog-comments")).toContainText("Original comment");
    expect((await post(editor, path, { operation: "delete_tail_reply", drid: drid!, drrid: drrid! })).ok()).toBe(true);
    expect((await post(page, `${path}/edit`, { operation: "publish", draft: false })).ok()).toBe(true);
    await viewer.goto(path, { waitUntil: "domcontentloaded" });
    await expect(viewer.locator("#blog-comments")).toContainText("Original comment");
    expect(
        (await db.collection<BlogCommentDoc>("document").findOne({ docId: new ObjectId(drid) }))?.reply,
    ).toHaveLength(0);
});

test("comments matrix preserves the official asymmetric deletion branches and shared posting grant", async ({
    page,
    viewer,
    editor,
}) => {
    const path = await createPost(page, "Comments matrix grants");
    await viewer.goto(path, { waitUntil: "domcontentloaded" });
    const { drid } = await addComment(viewer, path, "Viewer top");
    const { drrid } = await addComment(viewer, path, "Viewer nested", drid);
    try {
        await setCommentGrants(editor, ["DELETE_COMMENT"]);
        await viewer.goto(path, { waitUntil: "domcontentloaded" });
        await expect(viewer.locator('[name="dczcomments__dummy-box"], [data-blog-like]')).toHaveCount(0);
        expect((await post(viewer, path, { operation: "like", drid: drid!, liked: true })).status()).toBe(403);
        expect((await post(viewer, path, { operation: "reply", content: "Denied" })).status()).toBe(403);
        expect((await post(viewer, path, { operation: "delete_reply", drid: drid! })).status()).toBe(403);
        await expect(viewer.locator(`[data-comment-id="${drid}"] [data-type="comment"][data-op="delete"]`)).toHaveCount(
            0,
        );
        expect((await post(viewer, path, { operation: "delete_tail_reply", drid: drid!, drrid: drrid! })).ok()).toBe(
            true,
        );

        await setCommentGrants(editor, ["CREATE_COMMENT", "DELETE_COMMENT_IN_OWN_POST"]);
        const nested = await addComment(viewer, path, "Author cannot moderate nested", drid);
        expect(
            (await post(page, path, { operation: "delete_tail_reply", drid: drid!, drrid: nested.drrid! })).status(),
        ).toBe(403);
        const ownTop = await addComment(page, path, "Own top without own deletion grant");
        expect((await post(page, path, { operation: "delete_reply", drid: ownTop.drid! })).ok()).toBe(true);
        expect((await post(page, path, { operation: "delete_reply", drid: drid! })).ok()).toBe(true);
    } finally {
        await setCommentGrants(editor, defaultGrants);
    }
});

test("comments honor native pagination settings and domain-independent reads", async ({ page, viewer }) => {
    const path = await createPost(page, "Comments pagination");
    await viewer.goto(path, { waitUntil: "domcontentloaded" });
    for (let i = 1; i <= 4; i++) await addComment(viewer, path, `Pagination comment ${i}`);
    await viewer.goto(`/d/blogrestricted${path}`, { waitUntil: "domcontentloaded" });
    await expect(viewer.locator("[data-comment-id]")).toHaveCount(3);
    await expect(viewer.locator("[data-comment-id]").first()).toContainText("Pagination comment 4");
    await expect(viewer.locator("[data-comment-id]").last()).toContainText("Pagination comment 2");
    await viewer.goto(`/d/blogrestricted${path}?page=2`, { waitUntil: "domcontentloaded" });
    await expect(viewer.locator("[data-comment-id]")).toHaveCount(1);
    await expect(viewer.locator("[data-comment-id]")).toContainText("Pagination comment 1");
    expect((await viewer.goto(`${path}?page=0`, { waitUntil: "domcontentloaded" }))?.status()).toBe(403);
});

test("comments handle concurrent likes and repeated deletes and clean the entire article tree", async ({
    page,
    viewer,
    editor,
    db,
}) => {
    const path = await createPost(page, "Comments concurrency and cleanup");
    const did = new ObjectId(path.split("/").pop()!);
    await viewer.goto(path, { waitUntil: "domcontentloaded" });
    const { drid } = await addComment(viewer, path, "Concurrent top");
    const { drrid } = await addComment(viewer, path, "Concurrent nested", drid);
    for (const target of [{}, { drrid: drrid! }]) {
        const results = await Promise.all(
            Array.from({ length: 4 }, () =>
                post(viewer, path, { operation: "like", drid: drid!, ...target, liked: true }),
            ),
        );
        expect(results.every((r) => r.ok())).toBe(true);
    }
    const stored = await db.collection<BlogCommentDoc>("document").findOne({ docId: new ObjectId(drid) });
    expect(stored?.nLike).toBe(1);
    expect(stored?.reply?.[0].nLike).toBe(1);
    const extra = await addComment(viewer, path, "Repeated deletion target");
    await Promise.all(
        Array.from({ length: 2 }, () => post(viewer, path, { operation: "delete_reply", drid: extra.drid! })),
    );
    expect((await db.collection<BlogDoc>("document").findOne({ docId: did }))?.nReply).toBe(1);
    expect((await post(editor, `${path}/edit`, { operation: "delete" })).ok()).toBe(true);
    expect(await db.collection("document").countDocuments({ parentId: did, docType: 71 })).toBe(0);
    expect(await db.collection("document.status").countDocuments({ parentId: did, docType: 71 })).toBe(0);
});

test("comments inherit anonymous article reading but never allow guest mutations", async ({
    page,
    viewer,
    editor,
    browser,
    db,
}) => {
    const path = await createPost(page, "Comments anonymous reading");
    await viewer.goto(path, { waitUntil: "domcontentloaded" });
    const { drid } = await addComment(viewer, path, "Guest-readable comment");
    const context = await browser.newContext({
        baseURL: process.env.HYDRO_E2E_URL,
        storageState: { cookies: [], origins: [] },
    });
    const guest = await context.newPage();
    try {
        await setCommentGrants(editor, ["ACCESS", "VIEW_PUBLISHED", ...commentGrants], "guest");
        await guest.goto(path, { waitUntil: "domcontentloaded" });
        await expect(guest.locator("#blog-comments")).toContainText("Guest-readable comment");
        await expect(
            guest.locator('[name="dczcomments__dummy-box"], [data-blog-like], #blog-comments [data-op="delete"]'),
        ).toHaveCount(0);
        for (const data of [
            { operation: "reply", content: "Guest write" },
            { operation: "tail_reply", drid: drid!, content: "Guest reply" },
            { operation: "like", drid: drid!, liked: true },
            { operation: "delete_reply", drid: drid! },
        ]) {
            const denied = await guest.request.post(path, {
                headers: { Referer: guest.url(), Accept: "application/json" },
                data,
                maxRedirects: 0,
            });
            expect(denied.status()).toBe(200);
            const body = (await denied.json()) as { url: string };
            const login = new URL(body.url, process.env.HYDRO_E2E_URL);
            expect(login.pathname).toBe("/login");
            expect(login.searchParams.get("redirect")).toBe(path);
        }
        const doc = await db.collection<BlogCommentDoc>("document").findOne({ docId: new ObjectId(drid) });
        expect(doc).toMatchObject({ content: "Guest-readable comment", nLike: 0, reply: [] });
        expect(await db.collection("document").countDocuments({ docType: 71, owner: 0 })).toBe(0);
        expect(await db.collection("document.status").countDocuments({ docType: 71, uid: 0 })).toBe(0);
    } finally {
        await setCommentGrants(editor, [], "guest");
        await context.close();
    }
});

test("comments leave no orphan trees or statuses during article deletion races", async ({
    page,
    viewer,
    editor,
    db,
}) => {
    const path = await createPost(page, "Comments parent deletion race");
    const did = new ObjectId(path.split("/").pop()!);
    await viewer.goto(path, { waitUntil: "domcontentloaded" });
    const { drid } = await addComment(viewer, path, "Race parent");
    const results = await Promise.all([
        post(viewer, path, { operation: "reply", content: "Racing top" }),
        post(viewer, path, { operation: "tail_reply", drid: drid!, content: "Racing tail" }),
        post(viewer, path, { operation: "like", drid: drid!, liked: true }),
        post(editor, `${path}/edit`, { operation: "delete" }),
    ]);
    expect(results[3].ok()).toBe(true);
    expect(await db.collection("document").countDocuments({ docType: 71, parentId: did })).toBe(0);
    expect(await db.collection("document.status").countDocuments({ docType: 71, parentId: did })).toBe(0);
});
