import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

const IGNORED_FILES = ["node_modules/**", "coverage/**", "test-results/**", "playwright-report/**"];
const JS_FILES = ["**/*.{js,cjs,mjs}"];
const TS_FILES = ["**/*.{ts,cts,mts}"];
const HYDRO_IMPORT_RESTRICTIONS = {
    paths: [
        {
            name: "mongodb",
            allowTypeImports: true,
            message: "Import runtime MongoDB values from hydrooj; mongodb imports must be type-only.",
        },
    ],
    patterns: [
        {
            group: ["mongodb"],
            importNames: ["Filter", "ObjectId"],
            message: "Import Filter and ObjectId from hydrooj, including type-only imports.",
        },
    ],
};
const FEATURE_IMPORT_RESTRICTIONS = {
    ...HYDRO_IMPORT_RESTRICTIONS,
    patterns: [
        ...HYDRO_IMPORT_RESTRICTIONS.patterns,
        {
            regex: "^\\.{1,2}/?$|(?:^|/)(?:articles|comments|integration|review|settings|index(?:\\.ts)?)/?$",
            message: "Feature internals must import concrete modules, not composition-root entry points.",
        },
    ],
};

export default defineConfig(
    prettierRecommended,
    js.configs.recommended,
    {
        files: ["scripts/**/*.{mjs,cjs}"],
        languageOptions: { globals: globals.node },
    },
    {
        files: TS_FILES,
        extends: tseslint.configs.recommendedTypeChecked,
        languageOptions: {
            globals: {
                ...globals.node,
            },
            parserOptions: {
                project: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        files: [...JS_FILES, ...TS_FILES],
        plugins: {
            "simple-import-sort": simpleImportSort,
        },
        rules: {
            "arrow-parens": ["error", "always"],
            curly: ["error", "multi-line"],
            "import/no-cycle": "off",
            "no-await-in-loop": "off",
            "no-empty": "off",
            "no-extend-native": "error",
            "no-unused-vars": "off",

            "simple-import-sort/exports": "error",
            "simple-import-sort/imports": "error",

            "prettier/prettier": [
                "error",
                {},
                {
                    usePrettierrc: true,
                },
            ],
        },
    },
    {
        files: TS_FILES,
        rules: {
            "@typescript-eslint/consistent-type-imports": "error",
            "@typescript-eslint/naming-convention": [
                "error",
                { selector: "typeLike", format: ["PascalCase"] },
                { selector: "function", format: ["camelCase"], leadingUnderscore: "allow" },
            ],
            "@typescript-eslint/explicit-module-boundary-types": "off",
            "@typescript-eslint/no-empty-interface": "off",
            "@typescript-eslint/no-unsafe-enum-comparison": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-duplicate-enum-values": "error",
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    vars: "local",
                    args: "after-used",
                    caughtErrors: "all",
                    argsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                    destructuredArrayIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                },
            ],
            "@typescript-eslint/prefer-as-const": "error",
        },
    },
    {
        files: ["index.ts", "features/**/*.ts", "frontend/**/*.ts", "tests/unit/**/*.ts", "tests/helpers/fixtures.ts"],
        rules: {
            "no-restricted-imports": ["error", HYDRO_IMPORT_RESTRICTIONS],
        },
    },
    {
        files: ["features/**/*.ts"],
        rules: {
            "no-restricted-imports": ["error", FEATURE_IMPORT_RESTRICTIONS],
        },
    },
    {
        files: ["features/shared/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "hydrooj",
                            allowTypeImports: true,
                            message: "Shared contracts may reference Hydro types, not runtime services.",
                        },
                    ],
                    patterns: [
                        {
                            regex: "^(?!\\./|hydrooj$)",
                            message: "Shared contracts must depend only on sibling contracts and Hydro types.",
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["frontend/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    ...HYDRO_IMPORT_RESTRICTIONS,
                    patterns: [
                        ...HYDRO_IMPORT_RESTRICTIONS.patterns,
                        {
                            regex: "(?:^|/)features/(?!shared/)|(?:^|/)index(?:\\.ts)?$",
                            message: "Browser code may import shared contracts, not server modules or entry points.",
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["features/**/*.model.ts", "features/**/*.policy.ts", "features/**/*.projection.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    ...FEATURE_IMPORT_RESTRICTIONS,
                    patterns: [
                        ...FEATURE_IMPORT_RESTRICTIONS.patterns,
                        {
                            regex: "(?:^|/)(?:[^/]+\\.handler(?:\\.ts)?$|common/|integration/|frontend/|index(?:\\.ts)?$)",
                            message: "Models, policies and projections must not import request or UI orchestration.",
                        },
                    ],
                },
            ],
        },
    },
    { ignores: IGNORED_FILES },
);
