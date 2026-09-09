"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { getSettings, getSyncState, listGroups, listOutbox, listPaymentMethods, listPayments, seedDefaultData, subscribeToLocalDataChanges, subscribeToOutboxChanges, trySync } from "@/lib/db";
import type { Group, Payment, PaymentMethod, SyncState, UserSettings } from "@/lib/types";
import { OfflineAwareLink } from "@/components/offline-aware-link";
import { PaymentExport } from "@/components/payment-export";
import { PaymentImport } from "@/components/payment-import";

export default function SettingsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [pending, setPending] = useState(0);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [syncMessage, setSyncMessage] = useState("サーバー接続を確認中…");
  const syncUserId = sessionStatus === "authenticated" ? session.user?.id ?? null : null;

  async function refresh() {
    await seedDefaultData();
    const [outbox, state, nextPayments, nextGroups, nextPaymentMethods, nextSettings] = await Promise.all([listOutbox(), getSyncState(), listPayments(), listGroups(), listPaymentMethods(true), getSettings()]);
    setPending(outbox.length);
    setSyncState(state);
    setPayments(nextPayments);
    setGroups(nextGroups);
    setPaymentMethods(nextPaymentMethods);
    setSettings(nextSettings ?? null);
  }

  useEffect(() => {
    void refresh();
    const unsubscribeFromLocalData = subscribeToLocalDataChanges(() => void refresh());
    const unsubscribeFromOutbox = subscribeToOutboxChanges(() => void refresh());
    return () => {
      unsubscribeFromLocalData();
      unsubscribeFromOutbox();
    };
  }, []);

  async function sync() {
    const result = await trySync(syncUserId);
    setSyncMessage(result === "synced" ? "同期が完了しました" : result === "offline" ? "オフラインのため同期待ちです" : "同期待ちとして端末に保持しています");
    await refresh();
  }

  return <div className="page-narrow">
    <div className="page-header"><div><div className="eyebrow">Settings</div><h1>設定</h1><p className="lede">Payment Logの使い方と保存状態を確認できます。</p></div></div>
    <div className="settings-grid">
      <OfflineAwareLink className="settings-link" href="/settings/payment-methods"><div><h3>支払い方法</h3><p>追加・名前変更・並び替え・アーカイブ</p></div><span className="row-chevron" aria-hidden="true">›</span></OfflineAwareLink>
      <div className="settings-link"><div><h3>データの保存</h3><p>IndexedDB / この端末に保存</p></div><span className="tag">LOCAL FIRST</span></div>
    </div>
    <PaymentExport payments={payments} groups={groups} paymentMethods={paymentMethods} settings={settings} />
    <PaymentImport />
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-heading"><h2>同期ステータス</h2><button className="small-button" type="button" onClick={() => void sync()}>今すぐ確認</button></div>
      <div className="sync-note"><strong>{pending > 0 ? `${pending}件の変更が同期待ち` : "同期待ちの変更はありません"}</strong><br />{syncMessage}{syncState?.lastSyncedAt ? `（最終確認 ${new Date(syncState.lastSyncedAt).toLocaleString("ja-JP")}）` : ""}</div>
      <p className="helper-text" style={{ marginTop: 14, marginBottom: 0 }}>支払いの登録・編集は通信を待たず端末へ保存されます。同期サーバーを接続した環境では、オンライン復帰時にOutboxから送信されます。</p>
    </section>
    <section className="panel" style={{ marginTop: 16 }}><div className="panel-heading"><h2>このMVPについて</h2></div><p className="helper-text" style={{ marginBottom: 0 }}>家計簿の細かな分類ではなく、支払った瞬間のログに集中します。名目とグループは必要なときだけ追加できます。</p></section>
  </div>;
}
