"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export function OfflineAwareLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={(event) => {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          event.preventDefault();
          window.location.assign(href);
        }
      }}
    >
      {children}
    </Link>
  );
}
