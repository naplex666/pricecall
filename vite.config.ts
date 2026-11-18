import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { buffer: "buffer" },
  },
  define: {
    // Some Solana deps reference `global`; point it at globalThis.
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["buffer", "@solana/web3.js", "@anchor-lang/core", "@solana/spl-token"],
  },
});
