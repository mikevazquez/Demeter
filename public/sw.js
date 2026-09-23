const DEFAULT_URL = "/student";
const DEFAULT_ICON = "/pwa/icon/192";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function safeSameOriginPath(value) {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_URL;

  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return DEFAULT_URL;
    return url.pathname + url.search + url.hash;
  } catch {
    return DEFAULT_URL;
  }
}

self.addEventListener("push", (event) => {
  let payload = {
    title: "Studio Flow",
    body: "Tienes una nueva notificación.",
    url: DEFAULT_URL,
    tag: "studio-flow",
  };

  if (event.data) {
    try {
      const incoming = event.data.json();
      if (incoming && typeof incoming === "object") {
        payload = { ...payload, ...incoming };
      }
    } catch {
      const body = event.data.text();
      if (body) payload.body = body;
    }
  }

  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : "Studio Flow";

  const body =
    typeof payload.body === "string" && payload.body.trim()
      ? payload.body.trim()
      : "Tienes una nueva notificación.";

  const tag =
    typeof payload.tag === "string" && payload.tag.trim()
      ? payload.tag.trim()
      : "studio-flow";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: DEFAULT_ICON,
      badge: DEFAULT_ICON,
      data: {
        url: safeSameOriginPath(payload.url),
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetPath = safeSameOriginPath(event.notification.data?.url);
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if ("focus" in client) {
            if ("navigate" in client) {
              return client.navigate(targetUrl).then(() => client.focus());
            }
            return client.focus();
          }
        }

        return self.clients.openWindow(targetUrl);
      }),
  );
});
