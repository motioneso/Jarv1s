import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const rootDirectory = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "playwright-report/**",
      "test-results/**",
      "Jarvis Design System/**",
      ".claude/worktrees/**",
      ".claude/workflows/**",
      "docs/audit/**",
      "docs/audits/**"
    ]
  },
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node
      }
    }
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: rootDirectory
      }
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports"
        }
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "none",
          ignoreRestSiblings: true
        }
      ]
    }
  },
  {
    files: ["**/*.test.ts", "vitest.config.ts"],
    languageOptions: {
      globals: {
        ...globals.vitest
      }
    }
  },
  {
    files: ["apps/web/**/*.{js,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        caches: "readonly",
        self: "readonly"
      }
    },
    rules: {
      // #685: sparkle glyphs are a banned AI tell in the app UI.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "lucide-react",
              importNames: ["Sparkles"],
              message:
                "Sparkles is a banned AI-tell marker (#685). Use GitCommitHorizontal for Jarvis-held/generated items or BrandMark for product identity."
            }
          ]
        }
      ]
    }
  }
);
