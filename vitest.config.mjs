import { defineConfig } from "vitest/config";

export default defineConfig({
    esbuild: {
        tsconfigRaw: {
            compilerOptions: { experimentalDecorators: true },
        },
    },
    test: {
        environment: "node",
        include: ["tests/unit/**/*.test.ts"],
        setupFiles: ["tests/setup.ts"],
        passWithNoTests: false,
        allowOnly: false,
        testTimeout: 5000,
        hookTimeout: 5000,
        restoreMocks: true,
        coverage: {
            provider: "v8",
            include: [
                "features/articles/article.model.ts",
                "features/articles/article.projection.ts",
                "features/comments/comment.model.ts",
                "features/comments/comment.handler.ts",
                "features/articles/article.handler.ts",
                "features/common/base.handler.ts",
                "features/settings/settings.policy.ts",
                "features/settings/settings.model.ts",
                "features/settings/settings.handler.ts",
                "features/review/review.model.ts",
                "features/review/review.policy.ts",
                "features/review/review.handler.ts",
                "features/review/review.notifications.ts",
                "features/common/notifications.ts",
            ],
            reporter: ["text", "html", "json-summary"],
        },
    },
});
