"use client";

import { useState } from "react";
import { buildPaymentExportData, serializePaymentExportCsv, serializePaymentExportJson } from "@/lib/payment-export";
import type { Group, Payment, PaymentMethod, UserSettings } from "@/lib/types";

function localDateInputValue(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function PaymentExport({ payments, groups, paymentMethods, settings }: { payments: Payment[]; groups: Group[]; paymentMethods: PaymentMethod[]; settings: UserSettings | null }) {
  const [message, setMessage] = useState("");
  const availablePaymentCount = payments.filter((payment) => !payment.deletedAt).length;

  function exportFile(format: "csv" | "json") {
    const exportedAt = new Date().toISOString();
    const data = buildPaymentExportData(payments, groups, paymentMethods, settings, exportedAt);
    const date = localDateInputValue(new Date());
    if (format === "csv") {
      downloadFile(serializePaymentExportCsv(data), `payment-log-${date}.csv`, "text/csv");
      setMessage(`${data.payments.length}件をCSVで出力しました`);
      return;
    }
    downloadFile(serializePaymentExportJson(data), `payment-log-${date}.json`, "application/json");
    setMessage(`${data.payments.length}件をJSONで出力しました`);
  }

  return (
    <section className="panel export-panel" aria-labelledby="payment-export-heading">
      <div className="panel-heading"><div><h2 id="payment-export-heading">データを書き出す</h2><p className="helper-text export-description">この端末に保存されている未削除の支払いを出力します。</p></div><span className="helper-text">{availablePaymentCount}件</span></div>
      <div className="export-actions">
        <button className="secondary-button" type="button" onClick={() => exportFile("csv")} disabled={availablePaymentCount === 0}>CSVをダウンロード</button>
        <button className="secondary-button" type="button" onClick={() => exportFile("json")} disabled={availablePaymentCount === 0}>JSONをダウンロード</button>
      </div>
      <p className="helper-text export-note">論理削除済みの支払いは含みません。支払い方法はアーカイブ済みでも名称付きで保持します。</p>
      {message ? <p className="helper-text export-message" aria-live="polite">{message}</p> : null}
    </section>
  );
}
