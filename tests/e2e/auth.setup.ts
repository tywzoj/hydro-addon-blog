import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, test as setup } from "@playwright/test";

import { accounts } from "./accounts";

for (const role of ["author", "viewer", "editor"] as const) {
    setup(`authenticate ${role} through Hydro's login form`, async ({ page }) => {
        await page.goto("/login");
        const form = page.locator(".immersive--content form");
        await form.locator('input[name="uname"]').fill(accounts[role].name);
        await form.locator('input[name="password"]').fill(accounts[role].password);
        await Promise.all([
            page.waitForURL((url) => url.pathname === "/"),
            form.locator('input[name="login_submit"]').click(),
        ]);
        await page.goto("/blog");
        await expect(page.locator("html")).toHaveAttribute("data-page", "blog_main");
        const directory = join(process.env.HYDRO_E2E_OUTPUT!, "auth");
        await mkdir(directory, { recursive: true });
        await page.context().storageState({ path: join(directory, `${role}.json`) });
    });
}
