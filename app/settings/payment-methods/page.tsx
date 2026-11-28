"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addPaymentMethod, listPaymentMethods, movePaymentMethod, renamePaymentMethod,
  seedDefaultData, setPaymentMethodActive, subscribeToLocalDataChanges,
} from "@/lib/db";
import type { PaymentMethod } from "@/lib/types";
import { OfflineAwareLink } from "@/components/offline-aware-link";

type Notice = { kind: "success" | "error"; text: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "処理に失敗しました。もう一度お試しください。";
}

export default function PaymentMethodsPage() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [name, setName] = useState("");
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const latestRefresh = useRef(0);
  const operationInFlight = useRef(false);

  const activeMethods = useMemo(() => methods.filter((method) => method.isActive && !method.deletedAt), [methods]);
  const archivedMethods = useMemo(() => methods.filter((method) => !method.isActive || method.deletedAt), [methods]);
  const hasUnsavedChanges = activeMethods.some((method) => draftNames[method.id] !== undefined && draftNames[method.id] !== method.name);

  const refresh = useCallback(async () => {
    const sequence = ++latestRefresh.current;
    try {
      const nextMethods = await listPaymentMethods(true);
      if (sequence === latestRefresh.current) {
        setMethods(nextMethods);
        setLoading(false);
      }
    } catch (error) {
      if (sequence === latestRefresh.current) {
        setNotice({ kind: "error", text: `一覧の読み込みに失敗しました: ${errorMessage(error)}` });
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void seedDefaultData().then(refresh).catch((error) => {
      setNotice({ kind: "error", text: `初期化に失敗しました: ${errorMessage(error)}` });
      setLoading(false);
    });
    const unsubscribe = subscribeToLocalDataChanges((change) => {
      if (change.kind === "paymentMethods") void refresh();
    });
    return () => {
      latestRefresh.current += 1;
      unsubscribe();
    };
  }, [refresh]);

  async function runOperation(label: string, successText: string, action: () => Promise<unknown>) {
    if (operationInFlight.current) return false;
    operationInFlight.current = true;
    setPending(label);
    setNotice(null);
    try {
      await action();
      setNotice({ kind: "success", text: successText });
      await refresh();
      return true;
    } catch (error) {
      setNotice({ kind: "error", text: `${label}に失敗しました: ${errorMessage(error)}` });
      return false;
    } finally {
      operationInFlight.current = false;
      setPending(null);
    }
  }

  function discardDraft(id: string) {
    setDraftNames((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasUnsavedChanges || !name.trim()) return;
    const saved = await runOperation("追加", "支払い方法を追加しました。", () => addPaymentMethod(name));
    if (saved) setName("");
  }

  async function saveName(method: PaymentMethod) {
    const draft = draftNames[method.id] ?? method.name;
    if (draft.trim() === method.name) {
      discardDraft(method.id);
      return;
    }
    if (!draft.trim()) {
      setNotice({ kind: "error", text: "支払い方法名を入力してください。" });
      return;
    }
    const saved = await runOperation("名前の保存", "名前を保存しました。", () => renamePaymentMethod(method.id, draft));
    if (saved) discardDraft(method.id);
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLInputElement>, method: PaymentMethod) {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveName(method);
    } else if (event.key === "Escape") {
      discardDraft(method.id);
      setNotice(null);
    }
  }

  if (loading) return <div className="loading-state">支払い方法を読み込んでいます…</div>;

  return <div className="page-narrow">
    <OfflineAwareLink href="/settings" className="back-link">← 設定に戻る</OfflineAwareLink>
    <div className="page-header"><div><div className="eyebrow">Payment methods</div><h1>支払い方法</h1><p className="lede">よく使う順に並べておくと、入力がさらに速くなります。</p></div></div>
    <p className="helper-text method-edit-guide">名前は「保存」またはEnterで確定、Escapeまたは「取消」で破棄します。未保存の変更がある間は他の操作を一時停止します。</p>
    {hasUnsavedChanges ? <p role="status" className="method-draft-warning">未保存の名前があります。並び替えやページ移動の前に保存または取消してください。</p> : null}
    {notice ? <p role={notice.kind === "error" ? "alert" : "status"} className={notice.kind === "error" ? "error-banner" : "method-success"}>{notice.text}</p> : null}
    {pending ? <p role="status" className="helper-text method-pending">{pending}中…</p> : null}
    <form className="group-add" onSubmit={(event) => void add(event)}><input className="text-input" value={name} onChange={(event) => setName(event.target.value.slice(0, 40))} placeholder="例：楽天Pay、デビットカード" maxLength={40} aria-label="支払い方法名" disabled={pending !== null || hasUnsavedChanges} /><button className="secondary-button" type="submit" disabled={pending !== null || hasUnsavedChanges || !name.trim()}>＋ 追加</button></form>
    <section className="method-panel"><div className="panel-heading"><h2>利用中</h2><span className="helper-text">{activeMethods.length}件</span></div>
      {activeMethods.length === 0 ? <div className="empty-state">利用できる支払い方法がありません。</div> : activeMethods.map((method, index) => {
        const draft = draftNames[method.id] ?? method.name;
        const dirty = draft !== method.name;
        return <div className="method-item" key={method.id}>
          <div className="method-editor"><input className="text-input" value={draft} maxLength={40} aria-label={`${method.name}の名前`} aria-invalid={dirty && !draft.trim()} disabled={pending !== null} onChange={(event) => setDraftNames((previous) => ({ ...previous, [method.id]: event.target.value }))} onKeyDown={(event) => handleEditKeyDown(event, method)} />{dirty ? <span className="method-draft-hint">{draft.trim() ? "未保存" : "名前を入力してください"}</span> : null}</div>
          <div className="method-controls">
            <button className="small-button" type="button" disabled={!dirty || !draft.trim() || pending !== null} onClick={() => void saveName(method)} aria-label={`${method.name}の名前を保存`}>保存</button>
            <button className="small-button ghost" type="button" disabled={!dirty || pending !== null} onClick={() => discardDraft(method.id)} aria-label={`${method.name}の編集を取り消す`}>取消</button>
            <button className="small-button" type="button" disabled={hasUnsavedChanges || pending !== null || index === 0} onClick={() => void runOperation("並び替え", "表示順を保存しました。", () => movePaymentMethod(method.id, -1))} aria-label="上へ">↑</button>
            <button className="small-button" type="button" disabled={hasUnsavedChanges || pending !== null || index === activeMethods.length - 1} onClick={() => void runOperation("並び替え", "表示順を保存しました。", () => movePaymentMethod(method.id, 1))} aria-label="下へ">↓</button>
            <button className="small-button ghost" type="button" disabled={hasUnsavedChanges || pending !== null} onClick={() => void runOperation("アーカイブ", "支払い方法をアーカイブしました。", () => setPaymentMethodActive(method.id, false))}>アーカイブ</button>
          </div>
        </div>;
      })}
    </section>
    {archivedMethods.length > 0 ? <section className="method-panel archive-list" style={{ marginTop: 16 }}><div className="panel-heading"><h2>アーカイブ</h2><span className="helper-text">履歴の参照用に保持</span></div>{archivedMethods.map((method) => <div className="method-item" key={method.id}><span>{method.name}</span><button className="small-button ghost" type="button" disabled={hasUnsavedChanges || pending !== null} onClick={() => void runOperation("再表示", "支払い方法を再表示しました。", () => setPaymentMethodActive(method.id, true))}>再表示</button></div>)}</section> : null}
    <p className="helper-text" style={{ marginTop: 16 }}>履歴から参照されている支払い方法は物理削除せず、アーカイブして残します。</p>
  </div>;
}
