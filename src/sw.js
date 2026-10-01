import { precacheAndRoute } from "workbox-precaching";

// Standard app-shell precaching, same as vite-plugin-pwa's generateSW mode
// would have done automatically — required here because a custom service
// worker (needed for the share target below) replaces that default.
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Web Share Target: lets the OS "Share" sheet (from GPay, PhonePe, Paytm,
// gallery, etc.) list this app as a destination for an image. Since this
// is a static site with no server to receive the POST, we intercept it
// here in the service worker, stash the shared image in Cache Storage,
// and redirect the browser to the app with ?share=1 so the page knows to
// go pick it up (see the matching code in src/App.jsx).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/share-target/") {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const file = formData.get("image");
          if (file) {
            const cache = await caches.open("shared-images");
            await cache.put("/shared-image", new Response(file));
          }
        } catch (err) {
          console.error("share-target handling failed:", err);
        }
        return Response.redirect("/?share=1", 303);
      })()
    );
  }
});
