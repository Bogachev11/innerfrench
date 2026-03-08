"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/episodes", label: "Episodes", match: (p: string) => p.startsWith("/episodes") },
  { href: "/dashboard", label: "Progress", match: (p: string) => p.startsWith("/dashboard") },
  { href: "/vocab", label: "Words", match: (p: string) => p.startsWith("/vocab") },
  { href: "/word-count", label: "Word Count", match: (p: string) => p.startsWith("/word-count") },
];

export function TopTabs() {
  const pathname = usePathname();

  return (
    <div className="sticky top-0 z-40 bg-white/95 backdrop-blur">
      <div className="mx-auto max-w-2xl px-4 pt-3 pb-2">
        {/* <h1 className="text-3xl font-bold">InnerFrench podcast</h1> */}
      </div>
      <div className="mx-auto grid max-w-2xl grid-cols-4 gap-1 px-4 pb-2">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors ${
                active ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-700 hover:bg-gray-100"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

