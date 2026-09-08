"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  confirmSyncMigration,
  getSyncState,
  subscribeToSyncStateChanges,
  trySync,
} from "@/lib/db";
import type { SyncState } from "@/lib/types";

function displayName(session: { user?: { name?: string | null; email?: string | null } }) {
  return session.user?.name ?? session.user?.email ?? "このアカウント";
}

export function SyncMigrationPrompt() {
  const { data: session, status } = useSession();
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await getSyncState();
        if (active) setSyncState(next);
      } catch {
        if (active) setError("同期設定を読み込めませんでした。");
      }
    };

    void refresh();
    const unsubscribe = subscribeToSyncStateChanges(() => void refresh());
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (status !== "authenticated" || !session?.user?.id || !syncState) return null;

  const userId = session.user.id;
  const ownerMismatch = syncState.syncOwnerUserId !== null && syncState.syncOwnerUserId !== userId;
  if (syncState.migrationConfirmed && !ownerMismatch) return null;

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      await confirmSyncMigration(userId);
      const result = await trySync(userId);
      if (result === "pending") setError("同期を開始しましたが、未送信データが残っています。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "同期を開始できませんでした。");
    } finally {
      setSaving(false);
    }
  };

  if (ownerMismatch) {
    return (
      <section className="sync-migration-banner warning" role="alert">
        <div>
          <strong>同期を停止しています</strong>
          <p>この端末は別のアカウントで同期済みです。データの所有者を自動で切り替えないため、Pushを実行していません。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="sync-migration-banner" aria-live="polite">
      <div>
        <strong>{displayName(session)}で同期を開始しますか？</strong>
        <p>この端末の未送信データをこのアカウントへ送信します。データの削除や統合は行いません。</p>
      </div>
      <button type="button" className="small-button auth-button" onClick={() => void confirm()} disabled={saving}>
        {saving ? "準備中…" : "このアカウントで同期を開始"}
      </button>
      {error ? <p className="sync-migration-error">{error}</p> : null}
    </section>
  );
}
