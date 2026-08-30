"use client";

import { useEffect, useMemo, useState } from "react";
import { listGroups, listPaymentMethods, listPayments, seedDefaultData } from "@/lib/db";
import type { Group, Payment, PaymentMethod } from "@/lib/types";
import { PaymentDateHeading, PaymentList } from "@/components/payment-list";

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      await seedDefaultData();
      const [nextPayments, nextGroups, nextMethods] = await Promise.all([listPayments(), listGroups(), listPaymentMethods(true)]);
      setPayments(nextPayments);
      setGroups(nextGroups);
      setMethods(nextMethods);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "none") return payments.filter((payment) => !payment.groupId);
    if (filter === "all") return payments;
    return payments.filter((payment) => payment.groupId === filter);
  }, [filter, payments]);

  const grouped = useMemo(() => {
    const map = new Map<string, Payment[]>();
    filtered.forEach((payment) => {
      const key = new Date(payment.paidAt).toLocaleDateString("ja-JP");
      map.set(key, [...(map.get(key) ?? []), payment]);
    });
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="page-narrow">
      <div className="page-header">
        <div><div className="eyebrow">Payment history</div><h1>支払い履歴</h1><p className="lede">あとから名目やグループを整えられます。</p></div>
      </div>
      <div className="filter-bar">
        {[{ id: "all", label: "すべて" }, { id: "none", label: "グループなし" }, ...groups.map((group) => ({ id: group.id, label: group.name }))].map((item) => (
          <button key={item.id} type="button" className={filter === item.id ? "filter-chip active" : "filter-chip"} onClick={() => setFilter(item.id)}>{item.label}</button>
        ))}
      </div>
      {loading ? <div className="loading-state">履歴を読み込んでいます…</div> : grouped.length === 0 ? <div className="panel"><div className="empty-state">この条件の支払いはありません。</div></div> : grouped.map(([date, items]) => (
        <section className="history-section" key={date}>
          <PaymentDateHeading value={items[0].paidAt} />
          <PaymentList payments={items} paymentMethods={methods} groups={groups} />
        </section>
      ))}
    </div>
  );
}
