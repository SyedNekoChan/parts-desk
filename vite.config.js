import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* GitHub Pages serves a project site from /<repo-name>/, not from the
   domain root, so every asset URL needs that prefix or the built page
   loads a blank screen with 404s in the console. Set it from an env var
   so the same config works for a user/org site (base "/") and for local
   dev, without editing the file per environment.

   Change REPO below, or set VITE_BASE when building:
     VITE_BASE=/my-repo/ npm run build                                   */
const REPO = "parts-desk";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Dev server always serves from root; only the build needs the prefix.
  base: command === "build" ? (process.env.VITE_BASE ?? `/${REPO}/`) : "/",
  build: {
    outDir: "dist",
    sourcemap: false,
    // Keeps the vendor bundle separate so a copy edit doesn't invalidate
    // React in everyone's browser cache on the next deploy.
    rollupOptions: {
      output: {
        manualChunks: { react: ["react", "react-dom"] }
      }
    }
  },
  server: {
    port: 5173,
    // Only used when you run the optional proxy in server/. With no
    // proxy running, the app calls the APIs directly and this is inert.
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true
      }
    }
  }
}));
