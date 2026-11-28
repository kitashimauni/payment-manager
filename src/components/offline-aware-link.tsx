"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { warmOfflineRoutes } from "@/lib/pwa";
import { useNavigationBlocker } from "./navigation-blocker";

export function OfflineAwareLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const { confirmLeave } = useNavigationBlocker();

  useEffect(() => {
    const link = linkRef.current;
    if (!link) return;

    const warm = () => void warmOfflineRoutes([href]);
    if (!("IntersectionObserver" in window)) {
      warm();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        warm();
      },
      { rootMargin: "200px" },
    );
    observer.observe(link);
    return () => observer.disconnect();
  }, [href]);

  return (
    <Link
      href={href}
      ref={linkRef}
      className={className}
      onNavigate={(event) => {
        if (!confirmLeave()) event.preventDefault();
      }}
      onClick={(event) => {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          event.preventDefault();
          if (!confirmLeave()) return;
          window.location.assign(href);
        }
      }}
    >
      {children}
    </Link>
  );
}
