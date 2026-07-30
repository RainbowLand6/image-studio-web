import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  { ignores: ["dist", "src-tauri", "node_modules"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        crypto: "readonly",
        localStorage: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLCanvasElement: "readonly",
        HTMLDivElement: "readonly",
        HTMLImageElement: "readonly",
        CanvasRenderingContext2D: "readonly",
        File: "readonly",
        Blob: "readonly",
        Image: "readonly",
        ImageData: "readonly",
        KeyboardEvent: "readonly",
        URL: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        FileReader: "readonly",
        atob: "readonly",
        RequestInit: "readonly",
      },
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", ecmaFeatures: { jsx: true }, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tseslint, "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
];
