import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Epic Version Tracker",
  description: "Epic release reported by every public FHIR server in Epic's Brands bundle.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
