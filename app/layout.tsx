import type { Metadata, Viewport } from "next";
import "./tailwind.css";
import "./globals.css";
import "./ui-primitives.css";

export const metadata: Metadata = {
  applicationName: "Studio Flow",
  title: "Studio Flow",
  description: "Administración y portal de estudios boutique",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Studio Flow",
  },
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
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
