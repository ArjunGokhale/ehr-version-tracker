import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "EHR Version Tracker",
  description: "Software version reported by every public certified-EHR FHIR server.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
