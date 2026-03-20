import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";
import eslint from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "cdk.out/**",
      "integration-tests/infrastructure/**",
      "vitest.config.ts",
      "integration-tests/vitest.config.ts",
      "metrics-validations/vitest.config.ts",
    ],
  },
  eslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: ["**/*.ts"],
    languageOptions: {
      sourceType: "module",
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
      "no-unused-vars": "off", // Disable base rule for TypeScript files
    },
  },
  eslintPluginPrettierRecommended,
];
