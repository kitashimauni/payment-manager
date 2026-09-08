"use client";

import { useEffect, useMemo, useState } from "react";
import { listGroups, listPaymentMethods, listPayments, seedDefaultData, subscribeToLocalDataChanges } from "@/lib/db";
import type { Group, Payment, PaymentMethod } from "@/lib/types";
import { PaymentDateHeading, PaymentList } from "@/components/payment-list";
import {
  ALL_FILTER,
  DEFAULT_PAYMENT_SEARCH_FILTERS,
  filterPayments,
  isPaymentSearchActive,
  NO_GROUP_FILTER,
  type PaymentSearchFilters,
} from "@/lib/payment-search";

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [filters, setFilters] = useState<PaymentSearchFilters>(DEFAULT_PAYMENT_SEARCH_FILTERS);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    await seedDefaultData();
    const [nextPayments, nextGroups, nextMethods] = await Promise.all([listPayments(), listGroups(), listPaymentMethods(true)]);
    setPayments(nextPayments);
    setGroups(nextGroups);
    setMethods(nextMethods);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    return subscribeToLocalDataChanges(() => void refresh());
  }, []);

  function updateFilter<Key extends keyof PaymentSearchFilters>(key: Key, value: PaymentSearchFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setFilters(DEFAULT_PAYMENT_SEARCH_FILTERS);
  }

  const filtered = useMemo(() => filterPayments(payments, filters), [filters, payments]);
  const hasActiveFilters = isPaymentSearchActive(filters);

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
        <div><div className="eyebrow">Payment history</div><h1>支払い履歴</h1><p className="lede">名目や金額、期間、グループからすぐに探せます。</p></div>
      </div>
      <section className="panel search-panel" aria-labelledby="payment-search-heading">
        <div className="panel-heading search-panel-heading">
          <div><h2 id="payment-search-heading">履歴を検索</h2><p className="helper-text search-description">複数の条件を組み合わせて絞り込めます。</p></div>
          <button className="small-button" type="button" onClick={clearFilters} disabled={!hasActiveFilters}>条件をクリア</button>
        </div>
        <div className="search-grid">
          <label className="field search-field--wide" htmlFor="payment-search-query">
            <span className="field-label">名目で検索</span>
            <input id="payment-search-query" className="text-input" type="search" value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} placeholder="例：ランチ、家賃" />
          </label>
          <label className="field" htmlFor="payment-search-min-amount">
            <span className="field-label">最小金額（円）</span>
            <input id="payment-search-min-amount" className="text-input" type="number" min="0" step="1" inputMode="numeric" value={filters.minAmount} onChange={(event) => updateFilter("minAmount", event.target.value.replace(/\D/g, ""))} placeholder="指定なし" />
          </label>
          <label className="field" htmlFor="payment-search-max-amount">
            <span className="field-label">最大金額（円）</span>
            <input id="payment-search-max-amount" className="text-input" type="number" min="0" step="1" inputMode="numeric" value={filters.maxAmount} onChange={(event) => updateFilter("maxAmount", event.target.value.replace(/\D/g, ""))} placeholder="指定なし" />
          </label>
          <label className="field" htmlFor="payment-search-from-date">
            <span className="field-label">開始日</span>
            <input id="payment-search-from-date" className="text-input" type="date" value={filters.fromDate} onChange={(event) => updateFilter("fromDate", event.target.value)} />
          </label>
          <label className="field" htmlFor="payment-search-to-date">
            <span className="field-label">終了日</span>
            <input id="payment-search-to-date" className="text-input" type="date" value={filters.toDate} onChange={(event) => updateFilter("toDate", event.target.value)} />
          </label>
          <label className="field" htmlFor="payment-search-group">
            <span className="field-label">グループ</span>
            <select id="payment-search-group" className="select-input" value={filters.groupId} onChange={(event) => updateFilter("groupId", event.target.value)}>
              <option value={ALL_FILTER}>すべて</option>
              <option value={NO_GROUP_FILTER}>グループなし</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <label className="field" htmlFor="payment-search-method">
            <span className="field-label">支払い方法</span>
            <select id="payment-search-method" className="select-input" value={filters.paymentMethodId} onChange={(event) => updateFilter("paymentMethodId", event.target.value)}>
              <option value={ALL_FILTER}>すべて</option>
              {methods.map((method) => <option key={method.id} value={method.id}>{method.name}{!method.isActive || method.deletedAt ? "（アーカイブ済み）" : ""}</option>)}
            </select>
          </label>
        </div>
        <div className="search-result" aria-live="polite"><span><strong>{filtered.length}</strong>件</span><span>{hasActiveFilters ? `全${payments.length}件から絞り込み中` : "すべての履歴"}</span></div>
      </section>
      {loading ? <div className="loading-state">履歴を読み込んでいます…</div> : grouped.length === 0 ? <div className="panel"><div className="empty-state">この条件の支払いはありません。</div></div> : grouped.map(([date, items]) => (
        <section className="history-section" key={date}>
          <PaymentDateHeading value={items[0].paidAt} />
          <PaymentList payments={items} paymentMethods={methods} groups={groups} />
        </section>
      ))}
    </div>
  );
}
