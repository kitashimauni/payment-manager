"use client";

import { useEffect, useMemo, useState } from "react";
import { listGroups, listPaymentMethods, listPayments, seedDefaultData, subscribeToLocalDataChanges } from "@/lib/db";
import { formatYen } from "@/lib/format";
import type { Group, Payment, PaymentMethod } from "@/lib/types";
import { PaymentDateHeading, PaymentList } from "@/components/payment-list";
import {
  ALL_FILTER,
  DEFAULT_PAYMENT_SEARCH_FILTERS,
  filterPayments,
  isPaymentSearchActive,
  isPaymentAmountFilterValid,
  NO_GROUP_FILTER,
  type PaymentSearchFilters,
} from "@/lib/payment-search";
import { formatSummaryPeriod, getMonthPeriod, isSummaryPeriodValid, summarizePayments, type PaymentSummaryRow, type SummaryPeriod } from "@/lib/payment-summary";

type SummaryPeriodMode = "current" | "previous" | "custom";

function SummaryBreakdown({ title, rows }: { title: string; rows: PaymentSummaryRow[] }) {
  return (
    <div className="summary-breakdown">
      <div className="summary-breakdown-heading"><h3>{title}</h3><span className="helper-text">{rows.length}分類</span></div>
      {rows.length === 0 ? <div className="summary-empty">この期間の支払いはありません。</div> : <div className="summary-list">
        {rows.map((row) => <div className="summary-row" key={row.id}><div><strong>{row.label}</strong><span className="helper-text">{row.count}件</span></div><span>{formatYen(row.total)}</span></div>)}
      </div>}
    </div>
  );
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [filters, setFilters] = useState<PaymentSearchFilters>(DEFAULT_PAYMENT_SEARCH_FILTERS);
  const [summaryPeriodMode, setSummaryPeriodMode] = useState<SummaryPeriodMode>("current");
  const [summaryReferenceDate, setSummaryReferenceDate] = useState(() => new Date());
  const [customSummaryPeriod, setCustomSummaryPeriod] = useState<SummaryPeriod>(() => getMonthPeriod(summaryReferenceDate));
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

  useEffect(() => {
    const refreshSummaryReferenceDate = () => setSummaryReferenceDate(new Date());
    const timer = window.setInterval(refreshSummaryReferenceDate, 60_000);
    document.addEventListener("visibilitychange", refreshSummaryReferenceDate);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshSummaryReferenceDate);
    };
  }, []);

  function updateFilter<Key extends keyof PaymentSearchFilters>(key: Key, value: PaymentSearchFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setFilters(DEFAULT_PAYMENT_SEARCH_FILTERS);
  }

  function updateCustomSummaryPeriod<Key extends keyof SummaryPeriod>(key: Key, value: SummaryPeriod[Key]) {
    setCustomSummaryPeriod((current) => ({ ...current, [key]: value }));
  }

  const filtered = useMemo(() => filterPayments(payments, filters), [filters, payments]);
  const hasActiveFilters = isPaymentSearchActive(filters);
  const invalidMinAmount = !isPaymentAmountFilterValid(filters.minAmount);
  const invalidMaxAmount = !isPaymentAmountFilterValid(filters.maxAmount);
  const summaryPeriod = useMemo(() => {
    if (summaryPeriodMode === "previous") return getMonthPeriod(summaryReferenceDate, -1);
    if (summaryPeriodMode === "custom") return customSummaryPeriod;
    return getMonthPeriod(summaryReferenceDate);
  }, [customSummaryPeriod, summaryPeriodMode, summaryReferenceDate]);
  const summary = useMemo(() => summarizePayments(payments, groups, methods, summaryPeriod), [groups, methods, payments, summaryPeriod]);
  const hasInvalidCustomPeriod = summaryPeriodMode === "custom" && !isSummaryPeriodValid(summaryPeriod);
  const hasIncompleteCustomPeriod = summaryPeriodMode === "custom" && (!summaryPeriod.fromDate || !summaryPeriod.toDate);
  const hasReversedCustomPeriod = summaryPeriodMode === "custom" && summaryPeriod.fromDate > summaryPeriod.toDate;

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
            <input id="payment-search-min-amount" className="text-input" type="text" inputMode="numeric" pattern="[0-9]*" value={filters.minAmount} aria-invalid={invalidMinAmount} onChange={(event) => updateFilter("minAmount", event.target.value)} placeholder="指定なし" />
            {invalidMinAmount ? <span className="field-error">半角数字で入力してください。</span> : null}
          </label>
          <label className="field" htmlFor="payment-search-max-amount">
            <span className="field-label">最大金額（円）</span>
            <input id="payment-search-max-amount" className="text-input" type="text" inputMode="numeric" pattern="[0-9]*" value={filters.maxAmount} aria-invalid={invalidMaxAmount} onChange={(event) => updateFilter("maxAmount", event.target.value)} placeholder="指定なし" />
            {invalidMaxAmount ? <span className="field-error">半角数字で入力してください。</span> : null}
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
      <section className="panel summary-panel" aria-labelledby="payment-summary-heading">
        <div className="panel-heading summary-panel-heading">
          <div><h2 id="payment-summary-heading">支払い集計</h2><p className="helper-text summary-description">期間ごとの支出と内訳を確認できます。</p></div>
        </div>
        <div className="filter-bar summary-period-switcher" role="group" aria-label="集計期間">
          {([["current", "今月"], ["previous", "前月"], ["custom", "任意期間"]] as const).map(([mode, label]) => <button key={mode} className={summaryPeriodMode === mode ? "filter-chip active" : "filter-chip"} type="button" aria-pressed={summaryPeriodMode === mode} onClick={() => setSummaryPeriodMode(mode)}>{label}</button>)}
        </div>
        {summaryPeriodMode === "custom" ? <div className="summary-custom-range">
          <label className="field" htmlFor="summary-from-date"><span className="field-label">開始日</span><input id="summary-from-date" className="text-input" type="date" value={customSummaryPeriod.fromDate} onChange={(event) => updateCustomSummaryPeriod("fromDate", event.target.value)} /></label>
          <label className="field" htmlFor="summary-to-date"><span className="field-label">終了日</span><input id="summary-to-date" className="text-input" type="date" value={customSummaryPeriod.toDate} onChange={(event) => updateCustomSummaryPeriod("toDate", event.target.value)} /></label>
        </div> : null}
        <p className={hasInvalidCustomPeriod ? "summary-period-label error-text" : "summary-period-label"}>{hasIncompleteCustomPeriod ? "開始日と終了日を入力してください。" : hasReversedCustomPeriod ? "開始日は終了日以前にしてください。" : formatSummaryPeriod(summaryPeriod)}</p>
        {hasInvalidCustomPeriod ? <div className="summary-invalid" role="alert">有効な期間を指定すると集計を表示します。</div> : <>
          <div className="summary-metrics">
            <div className="summary-metric summary-metric-primary"><span className="summary-metric-label">合計額</span><strong>{formatYen(summary.total)}</strong></div>
            <div className="summary-metric"><span className="summary-metric-label">支払い件数</span><strong>{summary.count}件</strong></div>
            <div className="summary-metric"><span className="summary-metric-label">平均支払額</span><strong>{formatYen(summary.averageAmount)}</strong></div>
          </div>
          <div className="summary-breakdowns">
            <SummaryBreakdown title="グループ別" rows={summary.byGroup} />
            <SummaryBreakdown title="支払い方法別" rows={summary.byPaymentMethod} />
          </div>
        </>}
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
