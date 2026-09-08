"use client";

import { ChangeEvent, useRef, useState } from "react";
import { importPaymentBackup } from "@/lib/db";
import { parsePaymentBackup, type PaymentImportParseResult } from "@/lib/payment-import";

type ImportPreview = Extract<PaymentImportParseResult, { ok: true }>;

export function PaymentImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setPreview(null);
    setMessage("");
    setError("");
    setFileName(file?.name ?? "");
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("ファイルが大きすぎます。10MB以下のJSONを選択してください。");
      return;
    }

    try {
      const parsed = parsePaymentBackup(JSON.parse(await file.text()));
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      setPreview(parsed);
    } catch {
      setError("JSONファイルを読み込めません。ExportしたJSONを選択してください。");
    }
  }

  function cancelPreview() {
    setPreview(null);
    setFileName("");
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function confirmImport() {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await importPaymentBackup(preview.data);
      setMessage(`${result.applied}件を取り込みました。${result.skipped > 0 ? `既存データ${result.skipped}件は変更していません。` : ""}`);
      setPreview(null);
      setFileName("");
    } catch {
      setError("取り込みに失敗しました。既存データは変更されていません。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel import-panel" aria-labelledby="payment-import-heading">
      <div className="panel-heading"><div><h2 id="payment-import-heading">JSONバックアップを読み込む</h2><p className="helper-text import-description">ExportしたJSONを選択し、内容を確認してから取り込みます。</p></div></div>
      <label className="import-file" htmlFor="payment-import-file"><span className="field-label">JSONファイル</span><input ref={inputRef} id="payment-import-file" type="file" accept=".json,application/json" onChange={(event) => void selectFile(event)} /></label>
      {fileName && !preview ? <p className="helper-text import-file-name">{fileName}</p> : null}
      {error ? <p className="import-error" role="alert">{error}</p> : null}
      {preview ? <div className="import-preview" aria-live="polite">
        <p className="import-preview-title">{fileName}の内容を確認してください。</p>
        <dl className="import-summary">
          <div><dt>支払い</dt><dd>{preview.data.payments.length}件</dd></div>
          <div><dt>グループ</dt><dd>{preview.data.groups.length}件</dd></div>
          <div><dt>支払い方法</dt><dd>{preview.data.paymentMethods.length}件</dd></div>
          <div><dt>設定</dt><dd>{preview.data.settings ? "あり" : "なし"}</dd></div>
        </dl>
        <p className="helper-text import-merge-note">同じIDは更新日時が新しいデータだけを取り込みます。取り込んだ変更は同期対象になります。</p>
        <div className="import-actions"><button className="primary-button" type="button" onClick={() => void confirmImport()} disabled={busy}>{busy ? "取り込んでいます…" : "この内容を取り込む"}</button><button className="small-button" type="button" onClick={cancelPreview} disabled={busy}>取り消す</button></div>
      </div> : null}
      {message ? <p className="helper-text import-message" aria-live="polite">{message}</p> : null}
    </section>
  );
}
