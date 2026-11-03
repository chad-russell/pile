import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
export default defineConfig(({ mode }) => {
  // Sweatshop previews reach vite through a forwarded host: PREVIEW_HOST is
  // the public hostname (https, port 443) the owner's browser uses. Allow
  // exactly that host and point HMR's websocket at the https port; plain
  // `npm run dev` (no PREVIEW_HOST) keeps vite's localhost-only defaults.
  const { PREVIEW_HOST: previewHost } = loadEnv(mode, ".", "");
  return {
    base: "./",
    plugins: [react()],
    server: {
      port: 8765,
      strictPort: true,
      ...(previewHost && { allowedHosts: [previewHost], hmr: { clientPort: 443 } }),
    },
    test: { include: ["src/**/*.test.ts"] },
  };
});
