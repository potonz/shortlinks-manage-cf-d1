import pluginJs from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
    globalIgnores(["**/dist/**/*"], "Ignores dist files"),
    globalIgnores(["packages/*/src/worker-configuration.d.ts"]),
    {
        files: ["**/*.{js,mjs,cjs,ts}"],
        languageOptions: {
            globals: globals.bunBuiltin,
        },
    },
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                project: ["tsconfig.json", "./packages/*/tsconfig.json"],
                parser: tseslint.parser,
            },
        },
        rules: {
            "@typescript-eslint/consistent-type-imports": [
                "error",
                {
                    fixStyle: "inline-type-imports",
                },
            ],
        },
    },
    pluginJs.configs.recommended,
    ...tseslint.configs.recommended,
    {
        plugins: {
            "simple-import-sort": simpleImportSort,
        },
        rules: {
            "simple-import-sort/imports": "error",
            "simple-import-sort/exports": "error",
        },
    },
    stylistic.configs.customize({
        indent: 4,
        semi: true,
        jsx: true,
        quotes: "double",
    }),
    {
        rules: {
            "import/no-anonymous-default-export": "off",
            "@typescript-eslint/consistent-type-imports": [
                "error",
                {
                    fixStyle: "inline-type-imports",
                },
            ],
            "@typescript-eslint/no-unused-vars": "warn",
            "@stylistic/space-before-function-paren": [
                "error",
                {
                    anonymous: "always",
                    named: "never",
                    asyncArrow: "always",
                },
            ],
            "@stylistic/indent": [
                "error",
                4,
                {
                    offsetTernaryExpressions: false,
                    SwitchCase: 1,
                },
            ],
            "no-shadow": "off",
        },
    },
]);
