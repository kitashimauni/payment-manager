"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { listOutbox, subscribeToOutboxChanges, trySync } from "@/lib/db";
import { OfflineAwareLink } from "./offline-aware-link";
import { PwaRegistration } from "./pwa-registration";

const navigation = [
  { href: "/", label: "記録", icon: "＋" },
  { href: "/payments", label: "履歴", icon: "◷" },
  { href: "/groups", label: "グループ", icon: "◇" },
  { href: "/settings", label: "設定", icon: "⚙" },
];

function NetworkStatus() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
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
    const refresh = async () => {
      update();
      await refreshPending();
      try {
        await trySync();
      } catch {
        // Keep the locally calculated count when sync cannot be attempted.
      }
      await refreshPending();
    };
    const handleOnline = () => void refresh();
    const handleOffline = () => update();
    const unsubscribeFromOutbox = subscribeToOutboxChanges(() => void refreshPending());

    void refresh();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      active = false;
      unsubscribeFromOutbox();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <div className={`network-status ${online ? "is-online" : "is-offline"}`}>
      <span className="status-dot" aria-hidden="true" />
      {online ? (pending > 0 ? `同期待ち ${pending}` : "オンライン") : "オフライン"}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

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
            <NetworkStatus />
          </div>
        </header>
        <main className="page-container">{children}</main>
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
      </div>
    </>
  );
}
