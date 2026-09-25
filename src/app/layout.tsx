import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Meridian Demo",
  description: "External merchant demo for Cyccle Merchant V1",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
