import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // injectManifest (not the default generateSW) because we need our
      // own fetch handler in src/sw.js to catch screenshots shared in
      // from other apps (see share_target below).
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
      },
      includeAssets: ["favicon-16.png", "favicon-32.png", "apple-touch-icon.png"],
      manifest: {
        name: "Money Manager",
        short_name: "Money",
        description: "Personal accounts, spending, budgets, bills, and debts tracker.",
        theme_color: "#1F2A1D",
        background_color: "#F7F8F5",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // Lets Android's share sheet list "Money Manager" as a target when
        // sharing an image from GPay/PhonePe/Paytm/gallery/etc. iOS Safari
        // does not support this API at all (Apple platform limitation) —
        // on iOS, screenshots still have to be saved then uploaded/pasted
        // manually in the Quick Add screen.
        share_target: {
          action: "/share-target/",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            files: [{ name: "image", accept: ["image/*"] }],
          },
        },
      },
    }),
  ],
});
