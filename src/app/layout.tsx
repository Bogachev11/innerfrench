import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "French Podcast Tool",
  description: "InnerFrench podcast player with progress tracking",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="bg-white text-gray-900 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
