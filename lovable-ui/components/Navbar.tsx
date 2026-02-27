"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";

export default function Navbar() {
  const pathname = usePathname();
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement | null>(null);

  const navLinks = [
    { href: "/", label: "Home" },
    ...(isAuthenticated ? [{ href: "/projects", label: "Projects" }] : []),
    { href: "/community", label: "Community" },
    { href: "/learn", label: "Learn" },
  ];

  const handleLogout = async () => {
    setShowUserMenu(false);
    setShowMobileMenu(false);
    await logout();
  };

  useEffect(() => {
    setShowUserMenu(false);
    setShowMobileMenu(false);
  }, [pathname]);

  useEffect(() => {
    if (!showUserMenu && !showMobileMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (
        showUserMenu &&
        menuContainerRef.current &&
        !menuContainerRef.current.contains(target)
      ) {
        setShowUserMenu(false);
      }

      if (
        showMobileMenu &&
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(target) &&
        mobileMenuButtonRef.current &&
        !mobileMenuButtonRef.current.contains(target)
      ) {
        setShowMobileMenu(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (showUserMenu) {
        setShowUserMenu(false);
        menuButtonRef.current?.focus();
      }
      if (showMobileMenu) {
        setShowMobileMenu(false);
        mobileMenuButtonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showMobileMenu, showUserMenu]);

  return (
    <nav className="absolute top-0 left-0 right-0 z-30 px-4 pt-4" aria-label="Primary">
      <div className="mx-auto max-w-7xl">
        <div className="glass-panel ui-ring-frame rounded-2xl px-4 sm:px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-4 sm:gap-8 min-w-0">
              <Link
                href="/"
                className="flex items-center gap-2 text-lg sm:text-xl font-semibold text-white hover:opacity-95 transition-all duration-200"
              >
                <span className="inline-block w-6 h-6 rounded-md bg-gradient-to-br from-orange-400 via-pink-500 to-blue-500 shadow-[0_0_22px_rgba(236,72,153,0.28)]" />
                <span className="truncate">Lovable</span>
              </Link>

              <div className="hidden md:flex items-center gap-1 text-sm text-gray-300">
                {navLinks.map((link) => {
                  const isActive = pathname === link.href;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`px-3 py-2 rounded-lg ui-segment ${
                        isActive
                          ? "ui-segment-active"
                          : ""
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 text-sm">
              <button
                type="button"
                ref={mobileMenuButtonRef}
                className="md:hidden inline-flex items-center justify-center h-10 w-10 ui-btn ui-btn-ghost"
                aria-label={showMobileMenu ? "Close navigation menu" : "Open navigation menu"}
                aria-controls="mobile-nav-panel"
                aria-expanded={showMobileMenu}
                onClick={() => setShowMobileMenu((prev) => !prev)}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {showMobileMenu ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  )}
                </svg>
              </button>

              {isLoading ? (
                <div className="w-20 h-8 bg-gray-800/80 rounded-lg animate-pulse" />
              ) : isAuthenticated ? (
                <div className="relative" ref={menuContainerRef}>
                  <button
                    type="button"
                    ref={menuButtonRef}
                    onClick={() => setShowUserMenu((prev) => !prev)}
                    aria-haspopup="menu"
                    aria-expanded={showUserMenu}
                    aria-controls="user-menu"
                    className="flex items-center gap-2 px-2 sm:px-3 py-2 ui-btn ui-btn-ghost border-transparent hover:border-white/10"
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-medium">
                      {user?.name?.[0]?.toUpperCase() ||
                        user?.email?.[0]?.toUpperCase() ||
                        "U"}
                    </div>
                    <span className="text-white hidden sm:inline max-w-[140px] truncate">
                      {user?.name || user?.email?.split("@")[0]}
                    </span>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${
                        showUserMenu ? "rotate-180" : ""
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>

                  {showUserMenu && (
                    <div
                      id="user-menu"
                      role="menu"
                      className="absolute right-0 mt-2 w-56 glass-panel ui-ring-frame rounded-xl z-20 overflow-hidden"
                    >
                      <div className="px-4 py-3 border-b border-white/10">
                        <p className="text-white font-medium truncate">{user?.name || "User"}</p>
                        <p className="text-gray-400 text-sm truncate">{user?.email}</p>
                      </div>

                      <div className="py-1">
                        <Link
                          href="/projects"
                          role="menuitem"
                          className="flex items-center gap-3 px-4 py-2 text-gray-300 hover:bg-white/5 hover:text-white transition-colors rounded-lg mx-1"
                          onClick={() => setShowUserMenu(false)}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                            />
                          </svg>
                          My Projects
                        </Link>
                        <Link
                          href="/settings"
                          role="menuitem"
                          className="flex items-center gap-3 px-4 py-2 text-gray-300 hover:bg-white/5 hover:text-white transition-colors rounded-lg mx-1"
                          onClick={() => setShowUserMenu(false)}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                          </svg>
                          Settings
                        </Link>
                      </div>

                      <div className="border-t border-white/10 py-1">
                        <button
                          onClick={handleLogout}
                          role="menuitem"
                          className="flex items-center gap-3 w-[calc(100%-8px)] mx-1 px-4 py-2 text-red-300 hover:bg-red-950/20 hover:text-red-200 transition-colors rounded-lg"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                            />
                          </svg>
                          Sign out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="hidden sm:inline ui-btn ui-btn-ghost px-3 py-2"
                  >
                    Log in
                  </Link>
                  <Link
                    href="/register"
                    className="ui-btn ui-btn-primary px-3.5 sm:px-4 py-2 font-semibold"
                  >
                    Get started
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>

        {showMobileMenu && (
          <div
            id="mobile-nav-panel"
            ref={mobileMenuRef}
            className="md:hidden mt-2 glass-panel ui-ring-frame rounded-2xl p-2"
          >
            <div className="grid grid-cols-1 gap-1">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm ui-chip ${
                      isActive
                        ? "bg-white/10 border-white/20 text-white"
                        : ""
                    }`}
                    onClick={() => setShowMobileMenu(false)}
                  >
                    <span>{link.label}</span>
                    <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                );
              })}
            </div>

            {!isAuthenticated && !isLoading && (
              <div className="mt-2 pt-2 border-t border-white/10 grid grid-cols-2 gap-2">
                <Link
                  href="/login"
                  className="ui-btn ui-btn-ghost text-center px-3 py-2"
                  onClick={() => setShowMobileMenu(false)}
                >
                  Log in
                </Link>
                <Link
                  href="/register"
                  className="ui-btn ui-btn-primary text-center px-3 py-2 font-semibold"
                  onClick={() => setShowMobileMenu(false)}
                >
                  Get started
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
