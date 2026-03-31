"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useState } from "react";

const TABS = [
  { href: "/episodes", label: "Episodes", public: false, match: (p: string) => p.startsWith("/episodes") },
  { href: "/dashboard", label: "Progress", public: true, match: (p: string) => p.startsWith("/dashboard") },
  { href: "/vocab", label: "Words", public: false, match: (p: string) => p.startsWith("/vocab") },
  { href: "/word-count", label: "Word Count", public: true, match: (p: string) => p.startsWith("/word-count") },
];

export function TopTabs() {
  const pathname = usePathname();
  const { authenticated, loading, signIn, signOut } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const visibleTabs = TABS.filter((t) => t.public || authenticated);

  function handleSignIn() {
    setErrorMsg("");
    const { error } = signIn(password);
    if (error) {
      setErrorMsg(error);
    } else {
      setShowLogin(false);
      setPassword("");
    }
  }

  return (
    <div className="sticky top-0 z-40 bg-white/95 backdrop-blur">
      {/* Header */}
      <div className="mx-auto max-w-2xl px-4 pt-4 pb-3 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Learning French Through Listening</h1>
          <p className="text-sm text-gray-500">Based on podcasts via innerfrench.com</p>
        </div>

        {/* Auth button */}
        {!loading && (
          <div className="relative">
            {authenticated ? (
              <button
                onClick={() => signOut()}
                className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-100 transition-colors"
                title="Sign out"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="hidden sm:inline">Sign out</span>
              </button>
            ) : (
              <button
                onClick={() => setShowLogin(!showLogin)}
                className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 transition-colors"
                title="Sign in"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="hidden sm:inline">Sign in</span>
              </button>
            )}

            {/* Login dropdown */}
            {showLogin && !authenticated && (
              <div className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-white shadow-lg ring-1 ring-gray-200 p-4 z-50">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                  placeholder="Password"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
                  autoFocus
                />
                {errorMsg && (
                  <p className="text-xs text-red-600 mt-1">{errorMsg}</p>
                )}
                <button
                  onClick={handleSignIn}
                  disabled={!password}
                  className="mt-2 w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  Sign in
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className={`mx-auto grid max-w-2xl gap-1 px-4 pb-2`} style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, 1fr)` }}>
        {visibleTabs.map((tab) => {
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
