import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";
import pluginJs from "@eslint/js";

export default [
  { files: ["**/*.js"], languageOptions: { sourceType: "commonjs" } },
  { languageOptions: { globals: globals.node } },
  pluginJs.configs.recommended,
  eslintPluginPrettierRecommended,
  // This sets up describe, test, and it to be keywords eslint knows
  {
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
];
