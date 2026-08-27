"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { listGroups, listPayments, getSettings, now, saveGroup, saveSettings, seedDefaultData, uuid } from "@/lib/db";
import { formatYen } from "@/lib/format";
import type { Group, Payment, UserSettings } from "@/lib/types";

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    await seedDefaultData();
    const [nextGroups, nextPayments, nextSettings] = await Promise.all([listGroups(), listPayments(), getSettings()]);
    setGroups(nextGroups);
    setPayments(nextPayments);
    setSettings(nextSettings ?? null);
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, []);

  const stats = useMemo(() => new Map(groups.map((group) => {
    const items = payments.filter((payment) => payment.groupId === group.id);
    return [group.id, { count: items.length, total: items.reduce((sum, payment) => sum + payment.amount, 0) }];
  })), [groups, payments]);

  async function addGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    const timestamp = now();
    await saveGroup({ id: uuid(), name: cleanName, status: "active", createdAt: timestamp, updatedAt: timestamp, deletedAt: null });
    setName("");
    await refresh();
  }

  async function setCurrentGroup(groupId: string | null) {
    if (!settings) return;
    const updated = { ...settings, currentGroupId: groupId, updatedAt: now() };
    await saveSettings(updated);
    setSettings(updated);
  }

  if (loading) return <div className="loading-state">グループを読み込んでいます…</div>;

  return (
    <div className="page-narrow">
      <div className="page-header"><div><div className="eyebrow">Groups</div><h1>グループ</h1><p className="lede">旅行やイベントの支払いだけ、まとめて管理できます。</p></div></div>
      <form className="group-add" onSubmit={addGroup}><input className="text-input" value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} placeholder="例：京都旅行 2026" maxLength={80} aria-label="グループ名" /><button className="secondary-button" type="submit">＋ 作成</button></form>
      {groups.length === 0 ? <div className="panel"><div className="empty-state">グループはまだありません。必要なときだけ作成できます。</div></div> : <div className="group-list">
        {groups.map((group) => {
          const stat = stats.get(group.id) ?? { count: 0, total: 0 };
          const current = settings?.currentGroupId === group.id;
          return <div className={current ? "group-card current" : "group-card"} key={group.id}>
            {current ? <span className="current-badge">CURRENT GROUP</span> : null}
            <Link href={`/groups/${group.id}`}><h3>{group.name}</h3><div className="group-card-meta"><span>{stat.count}件</span><span>{formatYen(stat.total)}</span></div></Link>
            <button className="small-button ghost" type="button" onClick={() => void setCurrentGroup(current ? null : group.id)}>{current ? "解除する" : "現在のグループにする"}</button>
          </div>;
        })}
      </div>}
      <div className="panel" style={{ marginTop: 18 }}><p className="helper-text">Current Groupを設定すると、ホームで登録する支払いに自動でグループが付きます。「なし」に戻せば通常の支払いログに戻ります。</p><Link href="/" className="text-link">ホームで支払いを記録 →</Link></div>
    </div>
  );
}
