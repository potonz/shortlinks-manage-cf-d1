//  @ts-check

import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import { importX } from "eslint-plugin-import-x";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
    globalIgnores(["dist/**/*"], "Ignores dist files"),
    {
        files: ["**/*.{js,mjs,cjs,ts}"],
        languageOptions: {
            globals: globals.node,
        },
    },
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                project: true,
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
    importX.flatConfigs.typescript,
    pluginJs.configs.recommended,
    ...tseslint.configs.recommended,
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
