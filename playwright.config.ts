import { join } from "node:path";

import { defineConfig } from "@playwright/test";

const baseURL = process.env.HYDRO_E2E_URL;
const output = process.env.HYDRO_E2E_OUTPUT;
if (!baseURL?.match(/^http:\/\/127\.0\.0\.1:\d+$/) || !output) {
    throw new Error("Run E2E with yarn test:e2e to provision an isolated local Hydro environment");
}

export default defineConfig({
    testDir: "./tests/e2e",
    outputDir: join(output, "artifacts"),
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: true,
    timeout: 30000,
    globalTimeout: 300000,
    reporter: [["list"], ["html", { outputFolder: join(output, "report"), open: "never" }]],
    use: {
        baseURL,
        channel: process.env.HYDRO_E2E_BROWSER === "chromium" ? undefined : "chrome",
        locale: "en-US",
        actionTimeout: 10000,
        navigationTimeout: 15000,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    projects: [
        { name: "authentication", testMatch: "auth.setup.ts" },
        {
            name: "blog",
            testMatch: "*.spec.ts",
            dependencies: ["authentication"],
            use: { storageState: join(output, "auth", "author.json") },
        },
    ],
});
