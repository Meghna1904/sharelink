import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "public/app-react",
    emptyOutDir: true,
    lib: {
      entry: "src/ui/main.tsx",
      formats: ["es"],
      fileName: () => "bundle.js",
    },
    rollupOptions: {
      // In development / bundling, bundle react & react-dom into the output
      external: [],
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
