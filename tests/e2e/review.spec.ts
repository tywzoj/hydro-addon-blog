import { join } from "node:path";

import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

import { ReviewMessages } from "../../features/shared/constants";
import type { BlogDoc, BlogSettings } from "../../features/shared/types";
import { accounts } from "./accounts";
import { blogState, confirmAction, createPost, expect, fillPost, submitPost, test as base } from "./fixtures";

const test = base.extend<{ reporters: Page[] }>({
    reporters: async ({ browser, baseURL }, use) => {
        const contexts: BrowserContext[] = [];
        try {
            for (const role of ["reporterA", "reporterB", "reporterC"]) {
                contexts.push(
                    await browser.newContext({
                        baseURL,
                        storageState: join(process.env.HYDRO_E2E_OUTPUT!, "auth", `${role}.json`),
                    }),
                );
            }
            await use(await Promise.all(contexts.map((context) => context.newPage())));
        } finally {
            await Promise.all(contexts.map((context) => context.close()));
        }
    },
});

let owned: string[] = [];
const navigation = { waitUntil: "domcontentloaded" as const };
const did = (path: string) => new ObjectId(path.split("/").pop()!);
const reviewPath = (path: string) => `/blog/review/${did(path).toHexString()}`;
const headers = (page: Page) => ({ Accept: "application/json", Referer: page.url() });

async function sudo(page: Page) {
    await page.goto("/blog/settings/permissions", navigation);
    if (new URL(page.url()).pathname.endsWith("/user/sudo")) {
        await page.locator('.immersive--content input[name="password"]').fill(accounts.editor.password);
        await Promise.all([
            page.waitForURL((url) => !url.pathname.endsWith("/user/sudo"), navigation),
            page.locator('input[name="confirm"]').click(),
        ]);
    }
}

async function configure(page: Page, mode: string, reminders = true, interval = 1440, reportLimit = 3) {
    await sudo(page);
    await page.goto("/blog/settings", navigation);
    await page.locator('select[name="mode"]').selectOption(mode);
    await page.locator('input[name="reportLimit"]').fill(String(reportLimit));
    await page.locator('input[name="rejectionLimit"]').fill("3");
    await page.locator('input[name="reminders"]').setChecked(reminders);
    await page.locator('input[name="intervalMinutes"]').fill(String(interval));
    await Promise.all([
        page.waitForNavigation(navigation),
        mode === "disabled"
            ? confirmAction(page, page.getByRole("button", { name: "Save", exact: true }))
            : page.getByRole("button", { name: "Save", exact: true }).click(),
    ]);
    await expect(page.locator('select[name="mode"]')).toHaveValue(mode);
}

async function defaultReview(page: Page, enabled: boolean) {
    await sudo(page);
    await page.locator('[data-permission="REVIEW"] input[data-role="default"]').setChecked(enabled);
    await Promise.all([
        page.waitForNavigation(navigation),
        page.getByRole("button", { name: "Update Permission" }).click(),
    ]);
}

async function makePost(page: Page, title: string) {
    const path = await createPost(page, title);
    owned.push(path);
    return path;
}

async function postDoc(db: Db, path: string) {
    return (await db.collection<BlogDoc>("document").findOne({ domainId: "system", docType: 70, docId: did(path) }))!;
}

async function tokens(page: Page, path: string) {
    await page.goto(reviewPath(path), navigation);
    return {
        generation: await page.locator('input[name="generation"]').inputValue(),
        version: await page.locator('input[name="version"]').inputValue(),
    };
}

async function decide(page: Page, path: string, decision: string, comments = "") {
    const token = await tokens(page, path);
    return page.request.post(reviewPath(path), {
        headers: headers(page),
        form: { operation: "decide", ...token, decision, comments },
    });
}

async function report(page: Page, path: string, version: number, comments = "") {
    await page.goto("/blog", navigation);
    return page.request.post(`${path}/report`, {
        headers: headers(page),
        form: { operation: "report", version, comments },
    });
}

async function publication(page: Page, path: string, draft: boolean) {
    await page.goto("/blog", navigation);
    return page.request.post(`${path}/edit`, {
        headers: headers(page),
        form: { operation: "publish", draft: String(draft) },
    });
}

async function reviewerRole(editor: Page, grants: string[]) {
    await sudo(editor);
    await editor.goto("/blog/settings/roles", navigation);
    if (!(await editor.locator('tr[data-role="blogreviewer"]').count())) {
        await editor.getByRole("button", { name: "Create Role", exact: true }).click();
        const dialog = editor.locator(".dialog:visible");
        await dialog.locator('input[type="text"]').fill("blogreviewer");
        await Promise.all([editor.waitForNavigation(navigation), dialog.locator('[data-action="ok"]').click()]);
    }
    await editor.goto("/blog/settings/permissions", navigation);
    const names = await editor
        .locator("[data-permission]")
        .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-permission")!));
    for (const name of names) {
        await editor
            .locator(`[data-permission="${name}"] input[data-role="blogreviewer"]`)
            .setChecked(grants.includes(name));
    }
    await Promise.all([
        editor.waitForNavigation(navigation),
        editor.getByRole("button", { name: "Update Permission" }).click(),
    ]);
    const assigned = await editor.request.post("/blog/settings/users", {
        headers: headers(editor),
        form: { operation: "assign", uid: "3", role: "blogreviewer" },
    });
    expect(assigned.ok()).toBe(true);
}

async function freshLogin(browser: Browser, baseURL: string | undefined) {
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/login", navigation);
    const form = page.locator(".immersive--content form");
    await form.locator('input[name="uname"]').fill(accounts.reporterC.name);
    await form.locator('input[name="password"]').fill(accounts.reporterC.password);
    await Promise.all([
        page.waitForURL((url) => url.pathname === "/", navigation),
        form.locator('input[name="login_submit"]').click(),
    ]);
    await context.close();
}

test.beforeEach(() => {
    owned = [];
});
test.afterEach(async ({ editor }) => {
    await configure(editor, "disabled");
    await defaultReview(editor, false);
    const assigned = await editor.request.post("/blog/settings/users", {
        headers: headers(editor),
        form: { operation: "assign", uid: "3", role: "default" },
    });
    expect(assigned.ok()).toBe(true);
    for (const path of owned) {
        const deleted = await editor.request.post(`${path}/edit`, {
            headers: headers(editor),
            form: { operation: "delete" },
        });
        expect(deleted.ok()).toBe(true);
    }
});

test("notifications use recipient preferences for review decisions and mixed-language mentions", async ({
    page,
    viewer,
    editor,
    db,
}) => {
    async function setLanguage(target: Page, language: string) {
        await target.goto("/home/settings/preference", navigation);
        await target.locator('select[name="viewLang"]').selectOption(language);
        await Promise.all([
            target.waitForNavigation(navigation),
            target.locator('input.primary[type="submit"]').click(),
        ]);
    }
    async function latestNotice(uid: number, path: string) {
        const notice = await db
            .collection<{ content: string; to: number[] }>("message")
            .findOne({ to: uid, content: { $regex: did(path).toHexString() } }, { sort: { _id: -1 } });
        expect(notice).not.toBeNull();
        return JSON.parse(notice!.content) as { message: string; params: (string | number)[] };
    }

    await configure(editor, "before", false);
    try {
        await setLanguage(page, "zh");
        const path = await makePost(page, "Recipient language review");
        const feedback = '<b data-notice-markup="true">Please revise</b>';
        expect((await decide(editor, path, "reject", feedback)).ok()).toBe(true);
        expect(await latestNotice(accounts.author.id, path)).toMatchObject({
            message: "你的博客文章“{0}”（版本 {1}）未通过审查。{2}（{3:link}）。",
            params: ["Recipient language review", 0, feedback, path],
        });
        await page.goto("/home/messages?uid=1", navigation);
        await page.locator(".messagepad").getByRole("heading", { name: "Hydro", exact: true }).click();
        await expect(page.locator(".messagepad__content")).toContainText("未通过审查");
        await expect(page.locator(".messagepad__content")).toContainText(feedback);
        await expect(page.locator(".messagepad__content [data-notice-markup]")).toHaveCount(0);

        await setLanguage(page, "en");
        await setLanguage(editor, "zh");
        expect((await publication(page, path, false)).ok()).toBe(true);
        expect((await decide(editor, path, "approve")).ok()).toBe(true);
        expect(await latestNotice(accounts.author.id, path)).toMatchObject({
            message: ReviewMessages.ApprovedNotice,
        });

        await viewer.goto(path, navigation);
        const response = await viewer.request.post(path, {
            headers: headers(viewer),
            form: { operation: "reply", content: "@[](/user/2) @[](/user/4)" },
        });
        expect(response.ok()).toBe(true);
        expect(await latestNotice(accounts.author.id, path)).toEqual({
            message: "User {0} mentioned you in {1:link}",
            params: [accounts.viewer.name, path],
        });
        expect(await latestNotice(accounts.editor.id, path)).toEqual({
            message: "用户 {0} 在 {1:link} 中提到了你。",
            params: [accounts.viewer.name, path],
        });
        await editor.goto("/home/messages?uid=1", navigation);
        await editor.locator(".messagepad").getByRole("heading", { name: "Hydro", exact: true }).click();
        await expect(editor.locator(".messagepad__content")).toContainText("提到了你");
        await expect(editor.locator(`.messagepad__content a[href="${path}"]`)).toBeVisible();
    } finally {
        await setLanguage(page, "en");
        await setLanguage(editor, "en");
    }
});

test("review JSON responses omit IPs without losing decision tokens or stored addresses", async ({
    page,
    viewer,
    editor,
    db,
}) => {
    await configure(editor, "before", false);
    await reviewerRole(editor, ["ACCESS", "REVIEW"]);
    const path = await makePost(page, "Review IP privacy");
    const stored = await postDoc(db, path);
    expect(stored.ip).toEqual(expect.any(String));
    for (const reader of [viewer, editor]) {
        for (const prefix of ["", "/d/blogrestricted"]) {
            const queue = await reader.request.get(`${prefix}/blog/review`, {
                headers: { Accept: "application/json" },
            });
            expect(queue.ok()).toBe(true);
            const { ddocs } = (await queue.json()) as { ddocs: BlogDoc[] };
            const entry = ddocs.find((doc) => doc.docId.toString() === did(path).toHexString());
            expect(entry).toMatchObject({ title: stored.title, reviewPending: true });
            expect(entry).not.toHaveProperty("ip");
            const response = await reader.request.get(`${prefix}${reviewPath(path)}`, {
                headers: { Accept: "application/json" },
            });
            expect(response.ok()).toBe(true);
            const { ddoc } = (await response.json()) as { ddoc: BlogDoc };
            expect(ddoc).not.toHaveProperty("ip");
            expect(ddoc).toMatchObject({ title: stored.title, reviewGeneration: stored.reviewGeneration });
        }
    }
    expect((await postDoc(db, path)).ip).toBe(stored.ip);
    expect((await decide(viewer, path, "approve")).ok()).toBe(true);
    expect(await postDoc(db, path)).toMatchObject({ draft: false, ip: stored.ip });
});

test("review before publication enforces reviewer-only access, approval, comments and stale decisions", async ({
    page,
    viewer,
    editor,
    reporters,
    db,
    browser,
    baseURL,
}) => {
    const fresh = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
        const settings = await fresh.newPage();
        await settings.goto("/login", navigation);
        const login = settings.locator(".immersive--content form");
        await login.locator('input[name="uname"]').fill(accounts.editor.name);
        await login.locator('input[name="password"]').fill(accounts.editor.password);
        await Promise.all([
            settings.waitForURL((url) => url.pathname === "/", navigation),
            login.locator('input[name="login_submit"]').click(),
        ]);
        await settings.goto("/blog/settings", navigation);
        await expect(settings).toHaveURL(/\/user\/sudo$/);
        await settings.locator('.immersive--content input[name="password"]').fill(accounts.editor.password);
        await Promise.all([
            settings.waitForURL((url) => url.pathname === "/blog/settings", navigation),
            settings.locator('input[name="confirm"]').click(),
        ]);
        await expect(settings.locator('select[name="mode"]')).toHaveValue("disabled");
    } finally {
        await fresh.close();
    }
    await editor.goto("/blog", navigation);
    const buttons = editor.locator(".medium-3.columns .section.side a.expanded.button");
    await expect(buttons).toHaveText(["Create a Post", "My Blog", "Blog settings"]);
    await expect(buttons.filter({ hasText: "My Blog" })).toHaveAttribute("href", "/blog/4");
    for (const [reader, uid, name] of [
        [editor, 4, "blog_editor"],
        [viewer, 3, "blog_viewer"],
    ] as const) {
        await reader.goto(`/blog/${uid}`, navigation);
        const sidebar = reader.locator(".medium-3.columns .section.side").first();
        await expect(sidebar.getByRole("heading")).toHaveText(`${name}'s blog`);
        await expect(sidebar.locator("a.expanded.button")).toHaveText(["Create a Post"]);
        await reader.goto("/blog/2", navigation);
        await expect(sidebar.getByRole("heading")).toHaveText("blog_author's blog");
        await expect(sidebar.locator("a.expanded.button")).toHaveCount(0);
    }
    await configure(editor, "before");
    await editor.goto("/blog", navigation);
    await expect(buttons).toHaveText(["Create a Post", "My Blog", "Blog review", "Blog settings"]);
    await reviewerRole(editor, ["ACCESS", "VIEW_PUBLISHED", "REVIEW"]);
    const reviewFamily = editor.locator("tbody").filter({ has: editor.locator('[data-permission="REVIEW"]') });
    await expect(reviewFamily.locator(".col--family")).toHaveText("Blog review");
    expect(
        await reviewFamily
            .locator("[data-permission]")
            .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-permission"))),
    ).toEqual(["REVIEW", "RESET_REVIEW_COUNTERS"]);
    const path = await makePost(page, "Review pre-publication");
    let doc = await postDoc(db, path);
    expect(doc).toMatchObject({ draft: true, reviewPending: true, requiresReview: true });
    await expect(page.locator(".medium-3.columns [data-blog-actions]").getByRole("button")).toHaveText([
        "Withdraw from review",
        "Pin",
        "Delete",
    ]);
    await expect(page.locator(".section__footer")).toContainText("Pending review");
    await expect(page.locator("[data-blog-actions] .icon")).toHaveCount(0);
    await page.goto("/blog/2", navigation);
    const labels = page
        .locator(".discussion__item")
        .filter({ has: page.getByRole("link", { name: "Review pre-publication", exact: true }) })
        .locator(".supplementary > li");
    await expect(labels.nth(0)).toHaveText("Draft");
    await expect(labels.nth(1)).toHaveText("Pending review");
    expect(doc.firstPublishAt).toBeUndefined();
    expect((await viewer.goto(path, navigation))?.status()).toBe(403);
    expect((await viewer.goto(`${path}/edit`, navigation))?.status()).toBe(403);
    expect((await reporters[0].goto("/blog/review", navigation))?.status()).toBe(403);
    const token = await tokens(viewer, path);
    await expect(viewer.locator(".medium-9.columns").getByRole("heading", { level: 1 })).toHaveText(
        "Review pre-publication · Publication review",
    );
    await expect(viewer.locator(".section__body").filter({ hasText: "Publication review" })).toHaveCount(0);
    await expect(viewer.getByText("Rejections: 0", { exact: false })).toBeVisible();
    await expect(viewer.locator(".richmedia")).toContainText("Body for Review pre-publication");
    await expect(viewer.locator("form[data-blog-confirm] textarea")).toHaveCount(0);
    await viewer.getByRole("button", { name: "Reject article", exact: true }).press("Enter");
    await expect(viewer.locator(".dialog:visible")).toContainText("its rejection count will increase");
    await expect(viewer.locator('.dialog:visible textarea[name="reviewComments"]')).toBeFocused();
    await viewer.locator('.dialog:visible textarea[name="reviewComments"]').fill("Please clarify the article.");
    await viewer.locator('.dialog:visible [data-action="cancel"]').click();
    await expect(viewer.locator(".dialog:visible")).toHaveCount(0);
    const cancelled = await postDoc(db, path);
    expect(cancelled.reviewPending).toBe(true);
    expect(cancelled.rejectionCount ?? 0).toBe(0);
    expect(await db.collection("oplog").countDocuments({ type: "blog.review", did: did(path) })).toBe(0);
    await viewer.getByRole("button", { name: "Reject article", exact: true }).click();
    await expect(viewer.locator('.dialog:visible textarea[name="reviewComments"]')).toBeFocused();
    await expect(viewer.locator('.dialog:visible textarea[name="reviewComments"]')).toHaveValue(
        "Please clarify the article.",
    );
    await Promise.all([
        viewer.waitForNavigation(navigation),
        viewer.locator('.dialog:visible [data-action="ok"]').click(),
    ]);
    await page.goto(path, navigation);
    await expect(page.locator(".medium-9.columns > #blog-review-comments")).toContainText(
        "Please clarify the article.",
    );
    await expect(page.locator("#blog-review-comments").getByRole("heading")).toHaveText("Review comments");
    await editor.goto(path, navigation);
    await expect(editor.locator("#blog-review-comments")).toHaveCount(0);
    const nonAuthorDetail = await editor.request.get(path, { headers: { Accept: "application/json" } });
    expect(await nonAuthorDetail.json()).not.toHaveProperty("ddoc.lastReview");
    await expect(page.locator(".section__footer")).toContainText("Review rejected");
    await expect(page.locator(".section__footer")).not.toContainText("Rejections:");
    await expect(page.locator(".section__footer")).not.toContainText("Please clarify the article.");
    await expect(
        page.locator("[data-blog-actions]").getByRole("button", { name: "Submit for review", exact: true }),
    ).toBeVisible();
    expect((await postDoc(db, path)).rejectionCount).toBe(1);
    expect(
        await db.collection("message").countDocuments({ to: 2, content: { $regex: "Please clarify the article" } }),
    ).toBe(1);
    expect((await publication(page, path, false)).ok()).toBe(true);
    await page.goto(`${path}/edit`, navigation);
    await fillPost(page, "Review pre-publication edited", "Current content only", true);
    await submitPost(page);
    doc = await postDoc(db, path);
    expect(doc).toMatchObject({ draft: true, reviewPending: true, contentVersion: 1, rejectionCount: 1 });
    const stale = await viewer.request.post(reviewPath(path), {
        headers: headers(viewer),
        form: { operation: "decide", ...token, decision: "approve" },
    });
    expect(stale.status()).toBe(403);
    await tokens(viewer, path);
    await viewer.getByRole("button", { name: "Reject article", exact: true }).click();
    await viewer.locator('.dialog:visible textarea[name="reviewComments"]').fill("Do not include on approval");
    await viewer.locator('.dialog:visible [data-action="cancel"]').click();
    await viewer.getByRole("button", { name: "Approve article" }).click();
    await expect(viewer.locator(".dialog:visible")).toContainText("its review counters will be reset");
    await expect(viewer.locator(".dialog:visible textarea")).toHaveCount(0);
    await viewer.locator('.dialog:visible [data-action="no"]').click();
    await expect(viewer.locator(".dialog:visible")).toHaveCount(0);
    expect(await postDoc(db, path)).toMatchObject({ draft: true, reviewPending: true, rejectionCount: 1 });
    await Promise.all([
        viewer.waitForNavigation(navigation),
        confirmAction(viewer, viewer.getByRole("button", { name: "Approve article" })),
    ]);
    doc = await postDoc(db, path);
    expect(doc).toMatchObject({
        draft: false,
        reviewPending: false,
        rejectionCount: 0,
        reportCount: 0,
        requiresReview: false,
        lastReview: { decision: "approve", comments: "" },
    });
    expect(doc.firstPublishAt).toBeInstanceOf(Date);
    expect(doc.reportApprovedVersion).toBeUndefined();
    await reporters[0].goto(path, navigation);
    await expect(reporters[0].locator(".topic__content")).toContainText("Current content only");
    const publicResponse = await reporters[0].request.get(path, { headers: { Accept: "application/json" } });
    expect(await publicResponse.text()).not.toContain("Please clarify the article.");
    expect(
        await db.collection("oplog").countDocuments({ type: "blog.review", did: did(path), articleDomainId: "system" }),
    ).toBe(2);
});

test("pending withdrawal remains available to delegated non-owners and root", async ({ page, editor, viewer, db }) => {
    await configure(editor, "before");
    await reviewerRole(editor, ["ACCESS", "VIEW_DRAFT_OTHERS", "UNPUBLISH_OTHERS"]);
    const path = await makePost(page, "Delegated pending withdrawal");
    for (const actor of [viewer, editor]) {
        await actor.goto(path, navigation);
        const json = await actor.request.get(path, { headers: { Accept: "application/json" } });
        expect(await json.json()).not.toHaveProperty("ddoc.reviewPending");
        await expect(actor.getByRole("button", { name: "Submit for review", exact: true })).toHaveCount(0);
        await actor.getByRole("button", { name: "Withdraw from review", exact: true }).click();
        await expect(actor.locator(".dialog:visible")).toContainText("any pending review will be cancelled");
        await actor.locator('.dialog:visible [data-action="no"]').click();
        await expect(actor.locator(".dialog:visible")).toHaveCount(0);
        expect((await postDoc(db, path)).reviewPending).toBe(true);
        await Promise.all([
            actor.waitForNavigation(navigation),
            confirmAction(actor, actor.getByRole("button", { name: "Withdraw from review", exact: true })),
        ]);
        expect(await postDoc(db, path)).toMatchObject({ draft: true, reviewPending: false, requiresReview: true });
        if (actor === viewer) expect((await publication(page, path, false)).ok()).toBe(true);
    }
});

test("disabling review confirms automatic approval and hides review controls with accurate publication text", async ({
    page,
    editor,
    viewer,
    reporters,
    db,
}) => {
    await configure(editor, "after", true, 1440, 0);
    const reported = await makePost(page, "Disable review reported");
    const publishedAt = (await postDoc(db, reported)).firstPublishAt;
    expect((await report(viewer, reported, 0, "Pending report")).ok()).toBe(true);
    await configure(editor, "before");
    const pending = await makePost(page, "Disable review pending");
    const rejected = await makePost(page, "Disable review already rejected");
    expect((await decide(editor, rejected, "reject", "Still requires review")).ok()).toBe(true);

    await editor.goto("/blog/settings", navigation);
    await editor.locator('select[name="mode"]').selectOption("disabled");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor.locator(".dialog:visible")).toContainText("including reported articles");
    await expect(editor.locator(".dialog:visible")).toContainText("This cannot be undone.");
    await editor.locator('.dialog:visible [data-action="no"]').click();
    await expect(editor.locator(".dialog:visible")).toHaveCount(0);
    expect((await db.collection<BlogSettings>("blog.settings").findOne({ _id: "global" }))?.review?.mode).toBe(
        "before",
    );
    for (const path of [pending, reported]) {
        expect(await postDoc(db, path)).toMatchObject({ draft: true, reviewPending: true });
    }

    await Promise.all([
        editor.waitForNavigation(navigation),
        confirmAction(editor, editor.getByRole("button", { name: "Save", exact: true })),
    ]);
    for (const path of [pending, reported]) {
        expect(await postDoc(db, path)).toMatchObject({
            draft: false,
            reviewPending: false,
            requiresReview: false,
            reportCount: 0,
            rejectionCount: 0,
        });
        expect(
            await db
                .collection("oplog")
                .countDocuments({ type: "blog.review", did: did(path), automatic: true, settingsMode: "disabled" }),
        ).toBe(1);
        const title = (await postDoc(db, path)).title;
        expect(
            await db.collection("message").countDocuments({
                to: 2,
                $and: [{ content: { $regex: title } }, { content: { $regex: "was approved" } }],
            }),
        ).toBe(1);
    }
    expect((await postDoc(db, pending)).firstPublishAt).toBeInstanceOf(Date);
    expect((await postDoc(db, reported)).firstPublishAt).toEqual(publishedAt);
    expect((await postDoc(db, reported)).reportApprovedVersion).toBe(0);
    expect(await postDoc(db, rejected)).toMatchObject({
        draft: true,
        reviewPending: false,
        rejectionCount: 1,
        requiresReview: true,
    });
    await editor.goto("/blog", navigation);
    await expect(editor.locator('a[href="/blog/review"]')).toHaveCount(0);
    await expect(editor.locator(".medium-3.columns .section.side a.expanded.button")).toHaveText([
        "Create a Post",
        "My Blog",
        "Blog settings",
    ]);
    for (const reader of [editor, viewer]) {
        await reader.goto(pending, navigation);
        await expect(reader.locator("[data-blog-report]")).toHaveCount(0);
        await expect(reader.locator('a[href^="/blog/review"]')).toHaveCount(0);
    }
    expect((await report(reporters[0], pending, 0, "Disabled")).status()).toBe(403);
    await page.goto(`${pending}/edit`, navigation);
    await page.getByRole("button", { name: /^Update/ }).click();
    await expect(page.locator(".dialog:visible .dialog__body")).toHaveText("Save changes to this published article?");
    await page.locator('.dialog:visible [data-action="no"]').click();
    await expect(page.locator(".dialog:visible")).toHaveCount(0);
    await page.goto(rejected, navigation);
    await expect(page.getByRole("button", { name: "Submit for review", exact: true })).toBeVisible();
    await configure(editor, "after");
    expect((await report(reporters[0], reported, 0, "Still immune")).status()).toBe(403);
});

test("review reports deduplicate, cross the strict threshold, restore visibility and renew version eligibility", async ({
    page,
    viewer,
    editor,
    reporters,
    db,
}) => {
    await configure(editor, "after");
    const path = await makePost(page, "Review reported publication");
    const initial = await postDoc(db, path);
    const comment = await page.request.post(path, {
        headers: headers(page),
        form: { operation: "reply", content: "Preserved thread" },
    });
    expect(comment.ok()).toBe(true);
    await viewer.goto("/blog", navigation);
    const sameVersion = await Promise.all([
        viewer.request.post(`${path}/report`, {
            headers: headers(viewer),
            form: { operation: "report", version: 0, comments: "private report" },
        }),
        viewer.request.post(`${path}/report`, {
            headers: headers(viewer),
            form: { operation: "report", version: 0, comments: "private report" },
        }),
    ]);
    expect(sameVersion.some((response) => response.ok())).toBe(true);
    expect((await postDoc(db, path)).reportCount).toBe(1);
    expect(await db.collection("blog.report").countDocuments({ articleId: did(path), reporter: 3, version: 0 })).toBe(
        1,
    );
    const reportComments = '<b data-report-markup="true">another report</b>';
    expect((await report(reporters[0], path, 0, reportComments)).ok()).toBe(true);
    expect((await postDoc(db, path)).reportCount).toBe(2);
    await page.goto(path, navigation);
    await expect(page.locator(".section__footer")).not.toContainText("Reports:");
    await expect(page.locator(".section__footer")).not.toContainText("Rejections:");
    await expect(page.locator("#blog-review-comments")).toHaveCount(0);
    await viewer.goto(path, navigation);
    await expect(viewer.locator("#blog-review-comments")).toHaveCount(0);
    await editor.goto(path, navigation);
    const feedback = editor.locator(".medium-9.columns > #blog-review-comments");
    const actions = editor.locator("[data-blog-actions]");
    await expect(actions.getByRole("link", { name: "Blog review", exact: true })).toBeVisible();
    await expect(actions.getByRole("link", { name: "Reset review counters", exact: true })).toBeVisible();
    await expect(actions.locator(".icon")).toHaveCount(0);
    await expect(feedback).toHaveCount(0);
    for (const reader of [page, viewer, editor]) {
        const detailJSON = await reader.request.get(path, { headers: { Accept: "application/json" } });
        expect(detailJSON.ok()).toBe(true);
        const body: unknown = await detailJSON.json();
        for (const field of ["reportComments", "reportPage", "reportPageCount"]) {
            expect(body).not.toHaveProperty(field);
        }
        expect(await detailJSON.text()).not.toContain("private report");
        expect(await detailJSON.text()).not.toContain("data-report-markup");
    }
    await expect(editor.locator(".section__footer")).toContainText("Reports: 2");
    await expect(editor.locator(".section__footer")).not.toContainText("another report");
    for (const target of [path, `${path}/edit`, "/blog", "/blog/2"]) {
        const authorJSON = await page.request.get(target, { headers: { Accept: "application/json" } });
        expect(authorJSON.ok()).toBe(true);
        expect(await authorJSON.text()).not.toContain('"reportCount":');
    }
    await tokens(editor, path);
    await expect(editor.locator(".medium-9.columns").getByRole("heading", { level: 1 })).toHaveText(
        "Review reported publication · Report review",
    );
    await expect(editor.locator(".section__body").filter({ hasText: "Report review" })).toHaveCount(0);
    const entries = editor.locator(".section__body > .section__body");
    const reporterEntry = entries.filter({ hasText: reportComments });
    await expect(reporterEntry).toContainText("Reporter:");
    await expect(reporterEntry.getByRole("link", { name: accounts.reporterA.name, exact: true })).toHaveAttribute(
        "href",
        "/user/5",
    );
    await expect(
        entries.filter({ hasText: "private report" }).getByRole("link", { name: accounts.viewer.name, exact: true }),
    ).toHaveAttribute("href", "/user/3");
    await expect(editor.locator("[data-report-markup]")).toHaveCount(0);
    const reviewerJSON = await editor.request.get(reviewPath(path), { headers: { Accept: "application/json" } });
    expect(await reviewerJSON.json()).toHaveProperty("ddoc.reportCount", 2);
    expect((await report(viewer, path, 0, "duplicate")).ok()).toBe(true);
    expect((await postDoc(db, path)).reportCount).toBe(2);
    expect((await report(reporters[1], path, 0, "third")).ok()).toBe(true);
    expect((await postDoc(db, path)).draft).toBe(false);
    expect((await report(editor, path, 0, "fourth")).ok()).toBe(true);
    let doc = await postDoc(db, path);
    expect(doc).toMatchObject({ draft: true, reportCount: 4, reviewPending: true });
    expect(doc.firstPublishAt).toEqual(initial.firstPublishAt);
    expect((await viewer.goto(path, navigation))?.status()).toBe(403);
    const hiddenState = await blogState(db, [path]);
    const ownReceipt = await report(viewer, path, 0, "Must not replace the accepted private report");
    expect(ownReceipt.ok()).toBe(true);
    expect(await ownReceipt.json()).toMatchObject({ reported: true, duplicate: true });
    expect(await ownReceipt.text()).not.toContain("private report");
    expect(await ownReceipt.text()).not.toContain(initial.content);
    expect(await blogState(db, [path])).toEqual(hiddenState);
    const foreignReceipt = await report(reporters[2], path, 0, "Cannot borrow another reporter's acknowledgement");
    expect(foreignReceipt.status()).toBe(403);
    expect(await foreignReceipt.text()).not.toContain(initial.content);
    expect(await blogState(db, [path])).toEqual(hiddenState);
    expect(
        await db.collection("message").countDocuments({
            to: 2,
            $and: [{ content: { $regex: "unpublished after reports" } }, { content: { $regex: initial.title } }],
        }),
    ).toBe(1);
    await page.goto(`${path}/edit`, navigation);
    await fillPost(page, doc.title, "Edited while hidden", true);
    await submitPost(page);
    expect(await postDoc(db, path)).toMatchObject({
        draft: true,
        reviewPending: true,
        reportCount: 4,
        contentVersion: 1,
    });
    expect((await decide(editor, path, "approve")).ok()).toBe(true);
    doc = await postDoc(db, path);
    expect(doc).toMatchObject({ draft: false, reportCount: 0, rejectionCount: 0, reportApprovedVersion: 1 });
    expect((await report(reporters[2], path, 1, "immune")).status()).toBe(403);
    await viewer.goto(path, navigation);
    await expect(viewer.getByText("Preserved thread", { exact: true })).toBeVisible();
    const json = await viewer.request.get(path, { headers: { Accept: "application/json" } });
    expect(await json.text()).not.toContain("private report");
    await page.goto(`${path}/edit`, navigation);
    await fillPost(page, doc.title, "Changed again", false);
    await submitPost(page);
    await viewer.goto(path, navigation);
    await viewer.locator("[data-blog-report]").click();
    const dialog = viewer.locator(".dialog:visible");
    await dialog.locator('[name="reportComments"]').fill("New-version UI report");
    await Promise.all([
        viewer.waitForURL((url) => url.pathname === "/blog", navigation),
        dialog.locator('[data-action="ok"]').click(),
    ]);
    expect(await postDoc(db, path)).toMatchObject({
        reportCount: 1,
        contentVersion: 2,
        reviewPending: true,
        draft: false,
    });
    expect(await db.collection("blog.report").countDocuments({ articleId: did(path) })).toBe(5);
    expect((await report(page, path, 2, "self report")).status()).toBe(403);
});

test("review rejection limit and independent reset preserve holds through withdrawal and disabled mode", async ({
    page,
    viewer,
    editor,
    db,
}) => {
    await configure(editor, "before");
    const path = await makePost(page, "Review rejection limit");
    for (let count = 1; count <= 3; count++) {
        expect((await decide(editor, path, "reject", `Rejection ${count}`)).ok()).toBe(true);
        expect((await postDoc(db, path)).rejectionCount).toBe(count);
        if (count < 3) expect((await publication(page, path, false)).ok()).toBe(true);
    }
    for (const reader of [page, editor]) {
        for (const target of [path, `${path}/edit`]) {
            await reader.goto(target, navigation);
            await expect(reader.getByText(/Rejections:/)).toHaveCount(0);
            const response = await reader.request.get(target, { headers: { Accept: "application/json" } });
            expect(response.ok()).toBe(true);
            expect(await response.json()).not.toHaveProperty("ddoc.rejectionCount");
        }
        const response = await reader.request.get("/blog/2", { headers: { Accept: "application/json" } });
        expect(response.ok()).toBe(true);
        const body = (await response.json()) as { ddocs: BlogDoc[] };
        expect(body.ddocs.find((doc) => doc.docId.toString() === did(path).toHexString())).toBeDefined();
        for (const doc of body.ddocs) expect(doc).not.toHaveProperty("rejectionCount");
    }
    await page.goto(path, navigation);
    await expect(page.locator(".section__footer")).toContainText(
        "Publication is blocked by the review rejection limit.",
    );
    expect((await publication(page, path, false)).status()).toBe(403);
    await configure(editor, "disabled");
    expect((await publication(page, path, false)).status()).toBe(403);
    await reviewerRole(editor, ["ACCESS", "RESET_REVIEW_COUNTERS"]);
    expect((await viewer.goto(reviewPath(path), navigation))?.status()).toBe(403);
    await viewer.goto(`${reviewPath(path)}/reset`, navigation);
    expect(await viewer.locator(".topic__content").count()).toBe(0);
    await expect(viewer.locator(".section__body")).not.toContainText("Reports:");
    await expect(viewer.locator(".section__body")).toContainText("Rejections: 3");
    const resetJSON = await viewer.request.get(`${reviewPath(path)}/reset`, {
        headers: { Accept: "application/json" },
    });
    const resetBody: unknown = await resetJSON.json();
    expect(resetBody).not.toHaveProperty("reportCount");
    expect(resetBody).toHaveProperty("rejectionCount", 3);
    await viewer.getByRole("button", { name: "Reset review counters" }).click();
    await expect(viewer.locator(".dialog:visible")).toContainText("This does not publish or approve the article.");
    await viewer.locator('.dialog:visible [data-action="no"]').click();
    await expect(viewer.locator(".dialog:visible")).toHaveCount(0);
    expect((await postDoc(db, path)).rejectionCount).toBe(3);
    await Promise.all([
        viewer.waitForNavigation(navigation),
        confirmAction(viewer, viewer.getByRole("button", { name: "Reset review counters" })),
    ]);
    expect(await postDoc(db, path)).toMatchObject({ rejectionCount: 0, draft: true, requiresReview: true });
    expect((await publication(page, path, false)).ok()).toBe(true);
    expect(await postDoc(db, path)).toMatchObject({ draft: true, reviewPending: true });
    await page.goto(path, navigation);
    await page.getByRole("button", { name: "Withdraw from review" }).click();
    await expect(page.locator(".dialog:visible")).toContainText("any pending review will be cancelled");
    await page.locator('.dialog:visible [data-action="no"]').click();
    await expect(page.locator(".dialog:visible")).toHaveCount(0);
    expect((await postDoc(db, path)).reviewPending).toBe(true);
    await Promise.all([
        page.waitForNavigation(navigation),
        confirmAction(page, page.getByRole("button", { name: "Withdraw from review" })),
    ]);
    expect(await postDoc(db, path)).toMatchObject({ reviewPending: false, requiresReview: true });
    expect((await publication(page, path, false)).ok()).toBe(true);
    expect(await postDoc(db, path)).toMatchObject({ draft: true, reviewPending: true });
    expect((await decide(editor, path, "approve")).ok()).toBe(true);
    expect(await postDoc(db, path)).toMatchObject({ draft: false, requiresReview: false });
});

test("review and reset revocation rejects captured requests without changing protected data", async ({
    page,
    viewer,
    editor,
    db,
}) => {
    await configure(editor, "before", false);
    await reviewerRole(editor, ["ACCESS", "REVIEW", "RESET_REVIEW_COUNTERS"]);
    const path = await makePost(page, "Review revocation private target");
    const sentinel = await makePost(page, "Review revocation unrelated sentinel");
    expect((await decide(viewer, path, "reject", "Authorized rejection")).ok()).toBe(true);
    expect((await publication(page, path, false)).ok()).toBe(true);
    const captured = await tokens(viewer, path);
    await viewer.goto(`${reviewPath(path)}/reset`, navigation);
    const revision = await viewer.locator('input[name="revision"]').inputValue();
    const pending = await postDoc(db, path);
    expect(pending).toMatchObject({
        reviewPending: true,
        rejectionCount: 1,
        reviewGeneration: Number(captured.generation),
        writeRevision: Number(revision),
    });
    expect(pending.contentVersion ?? 0).toBe(Number(captured.version));

    await reviewerRole(editor, ["ACCESS", "VIEW_PUBLISHED"]);
    const before = await blogState(db, [path, sentinel]);
    for (const prefix of ["", "/d/blogrestricted"]) {
        for (const target of ["/blog/review", reviewPath(path), `${reviewPath(path)}/reset`]) {
            const denied = await viewer.request.get(`${prefix}${target}`, {
                headers: { Accept: "application/json" },
            });
            expect(denied.status()).toBe(403);
            expect(await denied.text()).not.toContain("Review revocation private target");
            expect(await blogState(db, [path, sentinel])).toEqual(before);
        }
        for (const decision of ["approve", "reject"]) {
            const denied = await viewer.request.post(`${prefix}${reviewPath(path)}`, {
                headers: headers(viewer),
                form: { operation: "decide", ...captured, decision, comments: "Denied after revocation" },
            });
            expect(denied.status()).toBe(403);
            expect(await blogState(db, [path, sentinel])).toEqual(before);
        }
        const deniedReset = await viewer.request.post(`${prefix}${reviewPath(path)}/reset`, {
            headers: headers(viewer),
            form: { operation: "reset_review", revision },
        });
        expect(deniedReset.status()).toBe(403);
        expect(await blogState(db, [path, sentinel])).toEqual(before);
    }

    await reviewerRole(editor, ["ACCESS", "REVIEW", "RESET_REVIEW_COUNTERS"]);
    const reset = await viewer.request.post(`${reviewPath(path)}/reset`, {
        headers: headers(viewer),
        form: { operation: "reset_review", revision },
    });
    expect(reset.ok(), await reset.text()).toBe(true);
    expect(await postDoc(db, path)).toMatchObject({ rejectionCount: 0, reviewPending: true, draft: true });
    expect((await decide(viewer, path, "approve")).ok()).toBe(true);
    expect(await postDoc(db, path)).toMatchObject({ draft: false, requiresReview: false });
});

test("review concurrent decisions produce one outcome and native audit through a restricted domain", async ({
    page,
    viewer,
    editor,
    db,
}) => {
    await configure(editor, "before");
    await reviewerRole(editor, ["ACCESS", "REVIEW"]);
    const path = await makePost(page, "Review concurrent decision");
    const one = await tokens(editor, path);
    const two = await tokens(viewer, path);
    const target = `/d/blogrestricted${reviewPath(path)}`;
    await viewer.goto(target, navigation);
    const responses = await Promise.all([
        editor.request.post(reviewPath(path), {
            headers: headers(editor),
            form: { operation: "decide", ...one, decision: "approve" },
        }),
        viewer.request.post(target, {
            headers: headers(viewer),
            form: { operation: "decide", ...two, decision: "reject", comments: "Concurrent rejection" },
        }),
    ]);
    expect(responses.map((r) => r.status()).sort()).toEqual([200, 403]);
    expect(
        await db.collection("oplog").countDocuments({ type: "blog.review", did: did(path), articleDomainId: "system" }),
    ).toBe(1);
    expect(
        await db.collection("message").countDocuments({ to: 2, content: { $regex: "Review concurrent decision" } }),
    ).toBe(1);
    const doc = await postDoc(db, path);
    expect(doc.reviewPending).toBe(false);
    expect(doc.rejectionCount).toBe(doc.draft ? 1 : 0);
});

test("review anonymous denial and native cascade preserve authorization and remove dependent reports", async ({
    page,
    viewer,
    editor,
    db,
    browser,
    baseURL,
}) => {
    await configure(editor, "after", true, 1440, 0);
    const path = await makePost(page, "Review cascade");
    await sudo(editor);
    for (const grant of ["ACCESS", "VIEW_PUBLISHED"]) {
        await editor.locator(`[data-permission="${grant}"] input[data-role="guest"]`).check();
    }
    await Promise.all([
        editor.waitForNavigation(navigation),
        editor.getByRole("button", { name: "Update Permission" }).click(),
    ]);
    const anonymous = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
        const guest = await anonymous.newPage();
        expect((await guest.goto(path, navigation))?.status()).toBe(200);
        const denied = await guest.request.post(`${path}/report`, {
            headers: headers(guest),
            form: { operation: "report", version: 0, comments: "anonymous" },
        });
        expect(await denied.json()).toHaveProperty("url", expect.stringContaining("/login"));
        expect(await db.collection("blog.report").countDocuments({ articleId: did(path) })).toBe(0);
        expect(
            (
                await page.request.post(path, {
                    headers: headers(page),
                    form: { operation: "reply", content: "Cascade dependency" },
                })
            ).ok(),
        ).toBe(true);
        expect((await report(viewer, path, 0, "Immediate hiding")).ok()).toBe(true);
        expect((await postDoc(db, path)).draft).toBe(true);
        const deleted = await page.request.post(`${path}/edit`, {
            headers: headers(page),
            form: { operation: "delete" },
        });
        expect(deleted.ok()).toBe(true);
        owned = owned.filter((entry) => entry !== path);
        expect(
            await db.collection("document").countDocuments({
                $or: [
                    { docType: 70, docId: did(path) },
                    { parentType: 70, parentId: did(path) },
                ],
            }),
        ).toBe(0);
        expect(
            await db
                .collection("document.status")
                .countDocuments({ $or: [{ docId: did(path) }, { parentId: did(path) }] }),
        ).toBe(0);
        expect(await db.collection("blog.report").countDocuments({ articleId: did(path) })).toBe(0);
    } finally {
        await anonymous.close();
        await sudo(editor);
        for (const grant of ["ACCESS", "VIEW_PUBLISHED"]) {
            await editor.locator(`[data-permission="${grant}"] input[data-role="guest"]`).uncheck();
        }
        await Promise.all([
            editor.waitForNavigation(navigation),
            editor.getByRole("button", { name: "Update Permission" }).click(),
        ]);
    }
});

test("review reminders use login and the real native worker, include default, and respect the switch", async ({
    page,
    editor,
    db,
    browser,
    baseURL,
}) => {
    test.setTimeout(170000);
    await configure(editor, "before", true, 1);
    await defaultReview(editor, true);
    await makePost(page, "Review reminder queue");
    const query = { to: 7, content: { $regex: "There are.*blog articles awaiting review" } };
    const initial = await db.collection("message").countDocuments(query);
    await freshLogin(browser, baseURL);
    await expect.poll(() => db.collection("message").countDocuments(query)).toBe(initial + 1);
    await expect
        .poll(() => db.collection("message").countDocuments(query), { timeout: 135000, intervals: [1000] })
        .toBeGreaterThan(initial + 1);
    const periodic = await db.collection("message").findOne({ ...query, "to.1": { $exists: true } });
    expect(periodic?.to).toEqual(expect.arrayContaining([2, 3, 4, 5, 6, 7]));
    expect(JSON.parse(periodic!.content as string)).toMatchObject({ message: ReviewMessages.SummaryNotice });
    await configure(editor, "before", false, 1);
    const disabled = await db.collection("message").countDocuments(query);
    await freshLogin(browser, baseURL);
    expect(await db.collection("message").countDocuments(query)).toBe(disabled);
    const path = owned[0];
    expect((await decide(editor, path, "reject", "Author notice remains enabled")).ok()).toBe(true);
    expect(
        await db.collection("message").countDocuments({ to: 2, content: { $regex: "Author notice remains enabled" } }),
    ).toBe(1);
});
