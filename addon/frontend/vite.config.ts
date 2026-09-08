import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The built bundle is copied into the image as /app/static, which FastAPI mounts.
// In dev, the API is proxied so the front end always talks to a same-origin /api.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    proxy: {
      "/api": "http://127.0.0.1:8234",
    },
  },
});
