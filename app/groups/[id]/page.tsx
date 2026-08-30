"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getGroup, getSettings, listPaymentMethods, listPayments, now, removeGroup, saveGroup, saveSettings, seedDefaultData } from "@/lib/db";
import { formatYen } from "@/lib/format";
import type { Group, Payment, PaymentMethod, UserSettings } from "@/lib/types";
import { PaymentList } from "@/components/payment-list";
import { Toast } from "@/components/toast";
import { warmOfflineRoutes } from "@/lib/pwa";

export default function GroupDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [group, setGroup] = useState<Group | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [groupName, setGroupName] = useState("");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    await seedDefaultData();
    const [nextGroup, nextPayments, nextMethods, nextSettings] = await Promise.all([getGroup(params.id), listPayments(), listPaymentMethods(true), getSettings()]);
    setGroup(nextGroup && !nextGroup.deletedAt ? nextGroup : null);
    setGroupName(nextGroup?.name ?? "");
    setPayments(nextPayments.filter((payment) => payment.groupId === params.id));
    setMethods(nextMethods);
    setSettings(nextSettings ?? null);
    setLoading(false);
  }

  useEffect(() => {
    void warmOfflineRoutes([`/groups/${params.id}`]);
    void refresh();
  }, [params.id]);

  const total = useMemo(() => payments.reduce((sum, payment) => sum + payment.amount, 0), [payments]);

  async function toggleCurrent() {
    if (!settings) return;
    const updated = { ...settings, currentGroupId: settings.currentGroupId === params.id ? null : params.id, updatedAt: now() };
    await saveSettings(updated);
    setSettings(updated);
  }

  async function rename() {
    const cleanName = groupName.trim();
    if (!group || !cleanName || cleanName === group.name) return;
    const updated = { ...group, name: cleanName, updatedAt: now() };
    await saveGroup(updated);
    setGroup(updated);
    setToast("グループ名を変更しました");
    window.setTimeout(() => setToast(""), 3000);
  }

  async function remove() {
    if (!group || !window.confirm(`「${group.name}」を削除しますか？\n支払いは削除されず、グループなしになります。`)) return;
    await removeGroup(group.id);
    router.push("/groups");
  }

  if (loading) return <div className="loading-state">グループを読み込んでいます…</div>;
  if (!group) return <div className="page-narrow"><Link href="/groups" className="back-link">← グループ一覧に戻る</Link><div className="panel"><div className="empty-state">グループが見つかりません。</div></div></div>;

  return <div className="page-narrow">
    <Link href="/groups" className="back-link">← グループ一覧に戻る</Link>
    <div className="page-header"><div><div className="eyebrow">Group detail</div><h1>{group.name}</h1><p className="lede">このグループに所属する支払いです。</p></div><button className="secondary-button" type="button" onClick={() => void toggleCurrent()}>{settings?.currentGroupId === group.id ? "Current Groupを解除" : "Current Groupに設定"}</button></div>
    <div className="panel" style={{ marginBottom: 16 }}><div className="group-add" style={{ marginBottom: 0 }}><input className="text-input" value={groupName} onChange={(event) => setGroupName(event.target.value.slice(0, 80))} maxLength={80} aria-label="グループ名" /><button className="secondary-button" type="button" onClick={() => void rename()}>名前を変更</button></div></div>
    <div className="total-card"><div><div className="eyebrow">Total</div><p className="total-amount">{formatYen(total)}</p></div><span className="total-count">{payments.length}件</span></div>
    <PaymentList payments={payments} paymentMethods={methods} groups={[group]} emptyMessage="このグループの支払いはまだありません。" />
    <div style={{ marginTop: 24, textAlign: "right" }}><button className="small-button" type="button" onClick={() => void remove()}>グループを削除</button></div>
    {toast ? <Toast message={toast} /> : null}
  </div>;
}
