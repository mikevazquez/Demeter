import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at 30% 20%, #5a103d 0%, #17101b 38%, #090a0f 72%)",
        borderRadius: "36px",
      }}
    >
      <div
        style={{
          width: "74%",
          height: "74%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "4px solid #ff0a8a",
          borderRadius: "50%",
          color: "#ffffff",
          fontSize: "52px",
          fontWeight: 800,
          letterSpacing: "-3px",
          boxShadow: "0 0 36px rgba(255,10,138,0.32)",
        }}
      >
        SF
      </div>
    </div>,
    size,
  );
}
