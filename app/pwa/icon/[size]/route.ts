import React from "react";
import { ImageResponse } from "next/og";

const SUPPORTED_SIZES = new Set([192, 512]);

function icon(size: number) {
  return React.createElement(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at 30% 20%, #5a103d 0%, #17101b 38%, #090a0f 72%)",
        borderRadius: String(Math.round(size * 0.2)) + "px",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          width: "74%",
          height: "74%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: String(Math.max(3, Math.round(size * 0.018))) + "px solid #ff0a8a",
          borderRadius: "50%",
          color: "#ffffff",
          fontSize: String(Math.round(size * 0.28)) + "px",
          fontWeight: 800,
          letterSpacing: String(Math.round(size * -0.015)) + "px",
          boxShadow: "0 0 44px rgba(255,10,138,0.32)",
        },
      },
      "SF",
    ),
  );
}

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: rawSize } = await params;
  const size = Number.parseInt(rawSize, 10);

  if (!SUPPORTED_SIZES.has(size)) {
    return new Response("Not found", { status: 404 });
  }

  return new ImageResponse(icon(size), {
    width: size,
    height: size,
  });
}
