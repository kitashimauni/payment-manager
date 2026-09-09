"use client";

import { SessionProvider as AuthSessionProvider } from "next-auth/react";

export function SessionProvider({ children, enabled }: { children: React.ReactNode; enabled: boolean }) {
  return <AuthSessionProvider session={enabled ? undefined : null}>{children}</AuthSessionProvider>;
}
