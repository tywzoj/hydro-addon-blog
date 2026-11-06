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
            include: ["features/model.ts", "features/handler.ts", "features/handler.base.ts"],
            reporter: ["text", "html", "json-summary"],
        },
    },
});
