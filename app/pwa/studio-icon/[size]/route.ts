import React from "react";
import { ImageResponse } from "next/og";

import { env } from "@/lib/env";

const SUPPORTED_SIZES = new Set([180, 192, 512]);

function safePrimary(value: string | null) {
  const primary = value?.trim() ?? "";
  return /^#[0-9a-f]{6}$/i.test(primary) ? primary : "#FF0A8A";
}

function safeLogoPath(value: string | null) {
  const path = value?.trim() ?? "";
  if (!path || path.includes("..") || path.includes("\\") || path.startsWith("/")) {
    return null;
  }

  return /^[A-Za-z0-9._/-]+$/.test(path) ? path : null;
}

function initials(value: string | null) {
  const words = (value?.trim() ?? "Studio Flow").split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function storageUrl(path: string) {
  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return env.supabaseUrl + "/storage/v1/object/public/studio-branding/" + encodedPath;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const { size: rawSize } = await params;
  const size = Number.parseInt(rawSize, 10);

  if (!SUPPORTED_SIZES.has(size)) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const primary = safePrimary(url.searchParams.get("primary"));
  const logoPath = safeLogoPath(url.searchParams.get("logo"));
  const name = url.searchParams.get("name");
  const logoUrl = logoPath ? storageUrl(logoPath) : null;

  const content = logoUrl
    ? React.createElement("img", {
        src: logoUrl,
        alt: "",
        style: {
          width: "76%",
          height: "76%",
          objectFit: "contain",
        },
      })
    : React.createElement(
        "div",
        {
          style: {
            color: "#ffffff",
            fontSize: String(Math.round(size * 0.24)) + "px",
            fontWeight: 800,
            letterSpacing: "-0.04em",
          },
        },
        initials(name),
      );

  return new ImageResponse(
    React.createElement(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#090A0F",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            width: "86%",
            height: "86%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: String(Math.max(2, Math.round(size * 0.012))) + "px solid " + primary,
            borderRadius: String(Math.round(size * 0.2)) + "px",
            boxShadow: "0 0 " + String(Math.round(size * 0.1)) + "px " + primary + "33",
            background: "#090A0F",
          },
        },
        content,
      ),
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    },
  );
}
