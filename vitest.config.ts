import { defineConfig } from "vitest/config";
// Отдельный конфиг: иначе vitest берёт vite.config.ts (root: "app") и не находит тесты.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
