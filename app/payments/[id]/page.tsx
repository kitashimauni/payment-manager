"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { formatDateTimeInput } from "@/lib/format";
import { getPayment, listGroups, listPaymentMethods, now, removePayment, savePayment, seedDefaultData } from "@/lib/db";
import type { Group, Payment, PaymentMethod } from "@/lib/types";
import { Toast } from "@/components/toast";

export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [methodId, setMethodId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      await seedDefaultData();
      const [nextPayment, nextMethods, nextGroups] = await Promise.all([getPayment(params.id), listPaymentMethods(true), listGroups()]);
      if (nextPayment && !nextPayment.deletedAt) {
        setPayment(nextPayment);
        setAmount(String(nextPayment.amount));
        setTitle(nextPayment.title ?? "");
        setMethodId(nextPayment.paymentMethodId);
        setGroupId(nextPayment.groupId ?? "");
        setPaidAt(formatDateTimeInput(nextPayment.paidAt));
      }
      setMethods(nextMethods);
      setGroups(nextGroups);
      setLoading(false);
    })();
  }, [params.id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payment || !Number.isSafeInteger(Number(amount)) || Number(amount) <= 0 || !methodId || !paidAt) return;
    const updated = { ...payment, amount: Number(amount), title: title.trim() || null, paymentMethodId: methodId, groupId: groupId || null, paidAt: new Date(paidAt).toISOString(), updatedAt: now() };
    await savePayment(updated);
    setPayment(updated);
    setToast("変更を保存しました");
    window.setTimeout(() => setToast(""), 3000);
  }

  async function remove() {
    if (!payment || !window.confirm("この支払いを削除しますか？")) return;
    await removePayment(payment.id);
    router.push("/payments");
  }

  if (loading) return <div className="loading-state">支払いを読み込んでいます…</div>;
  if (!payment) return <div className="page-narrow"><Link href="/payments" className="back-link">← 履歴に戻る</Link><div className="panel"><div className="empty-state">支払いが見つかりません。</div></div></div>;

  return (
    <div className="page-narrow">
      <Link href="/payments" className="back-link">← 履歴に戻る</Link>
      <div className="page-header"><div><div className="eyebrow">Edit payment</div><h1>支払いを編集</h1><p className="lede">名目やグループは後から追加できます。</p></div></div>
      <form className="detail-card panel" onSubmit={submit}>
        <div className="form-grid">
          <div className="field"><label className="field-label" htmlFor="edit-amount">金額（円）</label><input id="edit-amount" className="text-input" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))} /></div>
          <div className="field"><label className="field-label" htmlFor="edit-method">支払い方法</label><select id="edit-method" className="select-input" value={methodId} onChange={(event) => setMethodId(event.target.value)}>{methods.map((method) => <option value={method.id} key={method.id}>{method.name}{!method.isActive ? "（アーカイブ）" : ""}</option>)}</select></div>
          <div className="field"><label className="field-label" htmlFor="edit-title">名目（任意）</label><input id="edit-title" className="text-input" maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="昼食、コンビニ…" /></div>
          <div className="field"><label className="field-label" htmlFor="edit-group">グループ（任意）</label><select id="edit-group" className="select-input" value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">グループなし</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></div>
          <div className="field"><label className="field-label" htmlFor="edit-paid-at">支払日時</label><input id="edit-paid-at" className="text-input" type="datetime-local" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></div>
        </div>
        <div className="form-actions"><button className="danger-button" type="button" onClick={() => void remove()}>削除</button><button className="primary-button" type="submit">変更を保存</button></div>
      </form>
      {toast ? <Toast message={toast} /> : null}
    </div>
  );
}
