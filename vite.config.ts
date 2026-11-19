import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

// base для GitHub Pages: имя репозитория подставляется через env GITHUB_REPOSITORY
// или вручную через VITE_BASE. По умолчанию "/" (для кастомного домена / локальной сборки).
function resolveBase(): string {
  if (process.env.VITE_BASE) return process.env.VITE_BASE;
  const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
  return repo ? `/${repo}/` : "/";
}

export default defineConfig({
  base: resolveBase(),
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
