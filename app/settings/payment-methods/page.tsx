"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { listPaymentMethods, now, savePaymentMethod, seedDefaultData, uuid } from "@/lib/db";
import type { PaymentMethod } from "@/lib/types";
import { OfflineAwareLink } from "@/components/offline-aware-link";

export default function PaymentMethodsPage() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const activeMethods = useMemo(() => methods.filter((method) => method.isActive && !method.deletedAt), [methods]);
  const archivedMethods = useMemo(() => methods.filter((method) => !method.isActive || method.deletedAt), [methods]);

  async function refresh() {
    await seedDefaultData();
    setMethods(await listPaymentMethods(true));
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, []);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    const timestamp = now();
    await savePaymentMethod({ id: uuid(), name: cleanName, sortOrder: activeMethods.length, isActive: true, createdAt: timestamp, updatedAt: timestamp, deletedAt: null });
    setName("");
    await refresh();
  }

  async function rename(method: PaymentMethod, nextName: string) {
    const cleanName = nextName.trim();
    if (!cleanName || cleanName === method.name) return;
    await savePaymentMethod({ ...method, name: cleanName, updatedAt: now() });
    await refresh();
  }

  async function toggleArchive(method: PaymentMethod) {
    await savePaymentMethod({ ...method, isActive: !method.isActive, deletedAt: null, updatedAt: now() });
    await refresh();
  }

  async function move(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= activeMethods.length) return;
    const current = activeMethods[index];
    const target = activeMethods[targetIndex];
    const timestamp = now();
    await Promise.all([
      savePaymentMethod({ ...current, sortOrder: target.sortOrder, updatedAt: timestamp }),
      savePaymentMethod({ ...target, sortOrder: current.sortOrder, updatedAt: timestamp }),
    ]);
    await refresh();
  }

  if (loading) return <div className="loading-state">支払い方法を読み込んでいます…</div>;

  return <div className="page-narrow">
    <OfflineAwareLink href="/settings" className="back-link">← 設定に戻る</OfflineAwareLink>
    <div className="page-header"><div><div className="eyebrow">Payment methods</div><h1>支払い方法</h1><p className="lede">よく使う順に並べておくと、入力がさらに速くなります。</p></div></div>
    <form className="group-add" onSubmit={add}><input className="text-input" value={name} onChange={(event) => setName(event.target.value.slice(0, 40))} placeholder="例：楽天Pay、デビットカード" maxLength={40} aria-label="支払い方法名" /><button className="secondary-button" type="submit">＋ 追加</button></form>
    <section className="method-panel"><div className="panel-heading"><h2>利用中</h2><span className="helper-text">{activeMethods.length}件</span></div>
      {activeMethods.length === 0 ? <div className="empty-state">利用できる支払い方法がありません。</div> : activeMethods.map((method, index) => <div className="method-item" key={method.id}><input className="text-input" defaultValue={method.name} aria-label={`${method.name}の名前`} onBlur={(event) => void rename(method, event.target.value)} /><div className="method-controls"><button className="small-button" type="button" disabled={index === 0} onClick={() => void move(index, -1)} aria-label="上へ">↑</button><button className="small-button" type="button" disabled={index === activeMethods.length - 1} onClick={() => void move(index, 1)} aria-label="下へ">↓</button><button className="small-button ghost" type="button" onClick={() => void toggleArchive(method)}>アーカイブ</button></div></div>)}
    </section>
    {archivedMethods.length > 0 ? <section className="method-panel archive-list" style={{ marginTop: 16 }}><div className="panel-heading"><h2>アーカイブ</h2><span className="helper-text">履歴の参照用に保持</span></div>{archivedMethods.map((method) => <div className="method-item" key={method.id}><span>{method.name}</span><button className="small-button ghost" type="button" onClick={() => void toggleArchive(method)}>再表示</button></div>)}</section> : null}
    <p className="helper-text" style={{ marginTop: 16 }}>履歴から参照されている支払い方法は物理削除せず、アーカイブして残します。</p>
  </div>;
}
