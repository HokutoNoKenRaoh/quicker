import type { Metadata } from "next";
import type { ReactNode } from "react";
import { QUICKER } from "@/lib/game";
import "./globals.css";

export const metadata: Metadata = { title: QUICKER.title, description: QUICKER.description };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
