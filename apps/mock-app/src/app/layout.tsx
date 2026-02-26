import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auto Flixer - Mock App",
  description: "Mock app for Auto Flixer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
