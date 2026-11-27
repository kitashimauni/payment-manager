"use client";

import { useSession } from "next-auth/react";
import { createContext, useContext, useEffect, useState } from "react";

type SyncIdentity =
  | { status: "loading" | "unavailable" | "unauthenticated" | "local-only"; userId: null; displayName: null; mode: null }
  | { status: "authenticated"; userId: string; displayName: string; mode: "oauth" | "trusted-proxy-single-user" };

const unavailable: SyncIdentity = { status: "unavailable", userId: null, displayName: null, mode: null };
const unauthenticated: SyncIdentity = { status: "unauthenticated", userId: null, displayName: null, mode: null };
const localOnly: SyncIdentity = { status: "local-only", userId: null, displayName: null, mode: null };
const loading: SyncIdentity = { status: "loading", userId: null, displayName: null, mode: null };

const SyncIdentityContext = createContext<SyncIdentity>(loading);

export function SyncIdentityProvider({ children, enabled }: { children: React.ReactNode; enabled: boolean }) {
  const { data: session, status: sessionStatus } = useSession();
  const sessionUserId = session?.user?.id;
  const [identity, setIdentity] = useState<SyncIdentity>(enabled ? loading : localOnly);

  useEffect(() => {
    let active = true;
    let revision = 0;
    const controller = new AbortController();
    const refresh = async () => {
      const requestRevision = ++revision;
      if (!enabled) {
        setIdentity(localOnly);
        return;
      }
      if (!navigator.onLine) {
        setIdentity(unavailable);
        return;
      }
      const apply = (next: SyncIdentity) => {
        if (active && revision === requestRevision) setIdentity(next);
      };
      try {
        const response = await fetch("/api/sync/identity", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (response.status === 401) {
          const result: unknown = await response.json();
          if (typeof result === "object" && result !== null && "reason" in result && result.reason === "authentication-required") {
            return apply(unauthenticated);
          }
        }
        if (!response.ok) return apply(unavailable);
        const result: unknown = await response.json();
        if (typeof result === "object" && result !== null && "status" in result) {
          if (result.status === "local-only") return apply(localOnly);
          if (result.status === "authenticated" && "userId" in result && typeof result.userId === "string" &&
            "displayName" in result && typeof result.displayName === "string" && "mode" in result &&
            (result.mode === "oauth" || result.mode === "trusted-proxy-single-user")) {
            return apply({ status: "authenticated", userId: result.userId, displayName: result.displayName, mode: result.mode });
          }
        }
        apply(unavailable);
      } catch {
        apply(unavailable);
      }
    };
    setIdentity(enabled ? loading : localOnly);
    void refresh();
    const onOnline = () => void refresh();
    const onOffline = () => {
      revision += 1;
      if (enabled) setIdentity(unavailable);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      revision += 1;
      controller.abort();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, sessionStatus, sessionUserId]);

  return <SyncIdentityContext.Provider value={identity}>{children}</SyncIdentityContext.Provider>;
}

export function useSyncIdentity() {
  return useContext(SyncIdentityContext);
}
