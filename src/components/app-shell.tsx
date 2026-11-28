"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { listOutbox, subscribeToOutboxChanges, trySync } from "@/lib/db";
import { OfflineAwareLink } from "./offline-aware-link";
import { PwaRegistration } from "./pwa-registration";
import { SyncMigrationPrompt } from "./sync-migration-prompt";
import { useSyncIdentity } from "./sync-identity-provider";

const navigation = [
  { href: "/", label: "記録", icon: "＋" },
  { href: "/payments", label: "履歴", icon: "◷" },
  { href: "/groups", label: "グループ", icon: "◇" },
  { href: "/settings", label: "設定", icon: "⚙" },
];

function NetworkStatus({ syncUserId, syncUnavailable, loginRequired }: { syncUserId: string | null; syncUnavailable: boolean; loginRequired: boolean }) {
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let active = true;
    const update = () => {
      if (active) setOnline(navigator.onLine);
    };
    const refreshPending = async () => {
      try {
        const nextPending = (await listOutbox()).length;
        if (active) setPending(nextPending);
      } catch {
        if (active) setPending(0);
      }
    };
    const refresh = async (retryInFlight = false) => {
      update();
      await refreshPending();
      try {
        await trySync(syncUserId, { retryInFlight });
      } catch {
        // Keep the locally calculated count when sync cannot be attempted.
      }
      await refreshPending();
    };
    const handleOnline = () => void refresh(true);
    let onlineRetryTimer: number | undefined;
    const retryOnlineSync = () => {
      window.clearTimeout(onlineRetryTimer);
      onlineRetryTimer = window.setTimeout(() => {
        onlineRetryTimer = undefined;
        void refresh(true);
      }, 1_000);
    };
    const handleOffline = () => update();
    const unsubscribeFromOutbox = subscribeToOutboxChanges(() => void refresh());

    void refresh();
    window.addEventListener("online", handleOnline);
    window.addEventListener("online", retryOnlineSync);
    window.addEventListener("offline", handleOffline);
    return () => {
      active = false;
      unsubscribeFromOutbox();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("online", retryOnlineSync);
      window.clearTimeout(onlineRetryTimer);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncUserId]);

  return (
    <div className={`network-status ${online ? "is-online" : "is-offline"}`}>
      <span className="status-dot" aria-hidden="true" />
      {online ? (syncUnavailable ? "同期接続不可" : loginRequired ? "ログイン待ち" : pending > 0 ? `同期待ち ${pending}` : "オンライン") : "オフライン"}
    </div>
  );
}

export function AppShell({ children, authStatus }: { children: React.ReactNode; authStatus: React.ReactNode }) {
  const pathname = usePathname();
  const identity = useSyncIdentity();
  const syncUserId = identity.status === "authenticated" ? identity.userId : null;

  return (
    <>
      <PwaRegistration />
      <div className="app-background">
        <header className="topbar">
          <div className="topbar-inner">
            <OfflineAwareLink href="/" className="brand" aria-label="Payment Log ホーム">
              <span className="brand-mark">¥</span>
              <span>
                <strong>Payment Log</strong>
                <small>支払いを、すぐ残す。</small>
              </span>
            </OfflineAwareLink>
            <nav className="bottom-nav" aria-label="メインナビゲーション">
              {navigation.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <OfflineAwareLink key={item.href} href={item.href} className={active ? "nav-item active" : "nav-item"}>
                    <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                    <span>{item.label}</span>
                  </OfflineAwareLink>
                );
              })}
            </nav>
            <div className="topbar-actions">
              {identity.mode === "trusted-proxy-single-user" ? <span className="auth-status auth-user">Tailnet 同期</span> : null}
              {authStatus}
              <NetworkStatus syncUserId={syncUserId} syncUnavailable={identity.status === "unavailable"} loginRequired={identity.status === "unauthenticated"} />
            </div>
          </div>
        </header>
        <SyncMigrationPrompt />
        <main className={pathname === "/" ? "page-container home-page-container" : "page-container"}>{children}</main>
      </div>
    </>
  );
}
