import type { MetadataRoute } from "next";

function safeName(value: string | null) {
  const name = value?.trim().replace(/\s+/g, " ") ?? "";
  return name ? name.slice(0, 80) : "Studio Flow";
}

function safeSlug(value: string | null) {
  const slug = value?.trim().toLowerCase() ?? "";
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : "studio";
}

function safePrimary(value: string | null) {
  const primary = value?.trim() ?? "";
  return /^#[0-9a-f]{6}$/i.test(primary) ? primary : "#FF0A8A";
}

function safePortal(value: string | null) {
  return value === "admin" ? "admin" : "student";
}

function shortName(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  let result = "";

  for (const word of words) {
    const candidate = result ? result + " " + word : word;
    if (candidate.length > 18) break;
    result = candidate;
  }

  return result || name.slice(0, 18);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = safeName(url.searchParams.get("name"));
  const slug = safeSlug(url.searchParams.get("slug"));
  const primary = safePrimary(url.searchParams.get("primary"));
  const logo = url.searchParams.get("logo")?.trim() ?? "";
  const portal = safePortal(url.searchParams.get("portal"));
  const version = url.searchParams.get("v")?.trim() || "2";
  const startUrl = portal === "admin" ? "/admin" : "/student";
  const appName = portal === "admin" ? name + " Admin" : name;

  const iconQuery = new URLSearchParams({
    name: appName,
    primary,
    logo,
    v: version,
  }).toString();

  const manifest: MetadataRoute.Manifest = {
    id: "/pwa/" + slug + "/" + portal,
    name: appName,
    short_name: shortName(appName),
    description:
      portal === "admin"
        ? "Administración y operación de " + name + "."
        : "Reservas, progreso y comunicación de " + name + ".",
    start_url: startUrl,
    scope: "/",
    display: "standalone",
    background_color: "#090A0F",
    theme_color: primary,
    orientation: "portrait-primary",
    icons: [
      {
        src: "/pwa/studio-icon/192?" + iconQuery,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/studio-icon/512?" + iconQuery,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/studio-icon/512?" + iconQuery,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };

  return Response.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
