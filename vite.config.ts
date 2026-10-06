import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const hostProvidedDependencies = [
  "@wealthfolio/addon-sdk",
  "@wealthfolio/ui",
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // pdf.js (PDF statements, src/pdf/text.ts) is ~3 MB unminified; its own
    // minified builds keep addon.js at about half of that. The rest of the
    // bundle stays unminified.
    alias: {
      "pdfjs-dist/legacy/build/pdf.mjs": "pdfjs-dist/legacy/build/pdf.min.mjs",
      "pdfjs-dist/legacy/build/pdf.worker.mjs": "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    lib: {
      entry: "src/addon.tsx",
      fileName: () => "addon.js",
      formats: ["es"],
    },
    rollupOptions: {
      external: hostProvidedDependencies,
    },
    outDir: "dist",
    minify: false,
    sourcemap: false,
  },
});
