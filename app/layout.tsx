import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Private Metadata Cleaner — Inspect and remove image metadata",
    template: "%s · Private Metadata Cleaner",
  },
  description:
    "Inspect and remove metadata from JPEG, PNG, WebP, AVIF and HEIC images in your browser. Files never leave your device.",
  applicationName: "Private Metadata Cleaner",
};

export const viewport: Viewport = {
  themeColor: "#f5f7fb",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
