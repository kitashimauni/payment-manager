"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  getSettings,
  listGroups,
  listPaymentMethods,
  listPayments,
  now,
  removePayment,
  savePayment,
  saveSettings,
  seedDefaultData,
  trySync,
  uuid,
} from "@/lib/db";
import { formatYen } from "@/lib/format";
import type { Group, Payment, PaymentMethod, UserSettings } from "@/lib/types";
import { PaymentList } from "@/components/payment-list";
import { OfflineAwareLink } from "@/components/offline-aware-link";
import { Toast } from "@/components/toast";
import { warmOfflineRoutes } from "@/lib/pwa";
import { createPayment } from "@/lib/payment";

export default function HomePage() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [displayMethods, setDisplayMethods] = useState<PaymentMethod[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [recent, setRecent] = useState<Payment[]>([]);
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [selectedMethodId, setSelectedMethodId] = useState("");
  const [toast, setToast] = useState<{ message: string; payment?: Payment } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const currentGroup = useMemo(
    () => groups.find((group) => group.id === settings?.currentGroupId),
    [groups, settings?.currentGroupId],
  );

  async function refresh() {
    try {
      await seedDefaultData();
      const [nextMethods, nextDisplayMethods, nextGroups, nextSettings, nextPayments] = await Promise.all([
        listPaymentMethods(),
        listPaymentMethods(true),
        listGroups(),
        getSettings(),
        listPayments(),
      ]);
      setMethods(nextMethods);
      setDisplayMethods(nextDisplayMethods);
      setGroups(nextGroups);
      setSettings(nextSettings ?? null);
      setRecent(nextPayments.slice(0, 4));
      if (!selectedMethodId) {
        const remembered = window.localStorage.getItem("payment-log:last-method");
        setSelectedMethodId(remembered && nextMethods.some((method) => method.id === remembered) ? remembered : nextMethods[0]?.id ?? "");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "データを読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const clearToast = () => setToast(null);
    if (toast) {
      const timer = window.setTimeout(clearToast, 4500);
      return () => window.clearTimeout(timer);
    }
  }, [toast]);

  async function changeCurrentGroup(value: string) {
    if (!settings) return;
    const nextSettings = { ...settings, currentGroupId: value || null, updatedAt: now() };
    await saveSettings(nextSettings);
    setSettings(nextSettings);
    setToast({ message: value ? "Current Groupを変更しました" : "Current Groupを解除しました" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!Number.isSafeInteger(numericAmount) || numericAmount <= 0 || !selectedMethodId) {
      setToast({ message: "金額と支払い方法を入力してください" });
      return;
    }
    const timestamp = now();
    const payment = createPayment({
      id: uuid(),
      amount: numericAmount,
      paymentMethodId: selectedMethodId,
      title,
      currentGroupId: settings?.currentGroupId,
      timestamp,
    });
    await savePayment(payment);
    window.localStorage.setItem("payment-log:last-method", selectedMethodId);
    setRecent((items) => [payment, ...items].slice(0, 4));
    setAmount("");
    setTitle("");
    setToast({ message: `${formatYen(numericAmount)}を登録しました`, payment });
    void warmOfflineRoutes([`/payments/${payment.id}`]);
    void trySync();
  }

  async function undo() {
    if (!toast?.payment) return;
    await removePayment(toast.payment.id);
    setRecent((items) => items.filter((item) => item.id !== toast.payment?.id));
    setToast({ message: "登録を取り消しました" });
  }

  if (loading) return <div className="loading-state">準備しています…</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Quick capture</div>
          <h1>支払いを、すぐ残す。</h1>
          <p className="lede">金額と方法だけで、数秒で記録できます。</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="home-grid">
        <form className="entry-card" onSubmit={submit}>
          <div className="current-group-row">
            <span className="current-group-label">CURRENT GROUP</span>
            <select
              className="group-select"
              value={settings?.currentGroupId ?? ""}
              onChange={(event) => void changeCurrentGroup(event.target.value)}
              aria-label="Current Group"
            >
              <option value="">なし</option>
              {groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
            </select>
          </div>

          <div className="amount-wrap">
            <span className="currency">¥</span>
            <input
              className="amount-input"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="0"
              aria-label="金額"
              autoFocus
            />
          </div>

          <div className="field title-field">
            <label className="field-label" htmlFor="payment-title">名目（任意）</label>
            <input
              id="payment-title"
              className="text-input"
              value={title}
              onChange={(event) => setTitle(event.target.value.slice(0, 200))}
              placeholder="昼食、コンビニ、ホテル宿泊費…"
              maxLength={200}
            />
          </div>

          <div className="method-block">
            <p className="field-label">支払い方法</p>
            <div className="method-grid">
              {methods.map((method) => (
                <button
                  type="button"
                  key={method.id}
                  className={selectedMethodId === method.id ? "method-button selected" : "method-button"}
                  onClick={() => setSelectedMethodId(method.id)}
                >
                  {method.name}
                </button>
              ))}
            </div>
          </div>
          <button className="primary-button" type="submit" disabled={!amount || !selectedMethodId}>
            支払い登録
          </button>
          <p className="quick-hint">保存先はこの端末。オフラインでも記録できます。</p>
        </form>

        <aside className="side-stack">
          <section className="panel">
            <div className="panel-heading">
              <h2>最近の支払い</h2>
              <OfflineAwareLink className="text-link" href="/payments">すべて見る →</OfflineAwareLink>
            </div>
            <PaymentList payments={recent} paymentMethods={displayMethods} groups={groups} />
          </section>
          <section className="panel">
            <div className="panel-heading"><h2>整理するなら</h2></div>
            <p className="helper-text">旅行やイベントごとにCurrent Groupを設定すると、次の支払いに自動で付与されます。</p>
            <OfflineAwareLink className="secondary-button" href="/groups">グループを管理</OfflineAwareLink>
          </section>
          {currentGroup ? <div className="sync-note"><strong>{currentGroup.name}</strong> に支払いを記録中です。</div> : null}
        </aside>
      </div>
      {toast ? <Toast message={toast.message} action={toast.payment ? "元に戻す" : undefined} onAction={toast.payment ? () => void undo() : undefined} /> : null}
    </div>
  );
}
