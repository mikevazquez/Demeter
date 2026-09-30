import type { Metadata, Viewport } from "next";
import "./tailwind.css";
import "./globals.css";
import "./ui-primitives.css";

export const metadata: Metadata = {
  title: "Studio Flow",
  description: "Administración y portal de estudios boutique",
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#090A0F",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
