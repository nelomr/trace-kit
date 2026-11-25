import process from "node:process";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.SANDBOX_BASE ?? "/",
  build: {
    target: "es2022",
  },
});
