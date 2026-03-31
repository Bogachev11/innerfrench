import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/AuthContext";
import { TopTabs } from "./TopTabs";

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
      <body className="bg-white text-gray-900 font-sans antialiased" suppressHydrationWarning>
        <AuthProvider>
          <TopTabs />
          {children}
          <footer className="mx-auto w-full max-w-2xl px-4 py-2 mt-0 border-t border-gray-100">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
              <span>Alexander Bogachev, Data Visualization Lead</span>
              <span className="text-gray-300">&bull;</span>
              <a href="https://x.com/bogachev_al" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-900 transition-colors">
                <svg className="w-3.5 h-3.5 fill-current shrink-0" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                bogachev_al
              </a>
              <span className="text-gray-300">&bull;</span>
              <a href="https://linkedin.com/in/bogachev-aleksandr" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-900 transition-colors">
                <svg className="w-3.5 h-3.5 fill-current shrink-0" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                in/bogachev-aleksandr
              </a>
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
