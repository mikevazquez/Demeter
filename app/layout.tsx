import type { Metadata } from "next";
import "./tailwind.css";
import "./globals.css";
import "./ui-primitives.css";

export const metadata: Metadata = {
  title: "Studio Flow",
  description: "Administración de estudios boutique",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
