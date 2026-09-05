# 実装状況

企画書 `payment-management-webapp-plan.md` のMVPを、まずサーバー接続なしで価値が成立するLocal First版として実装した。

## 企画書との対応

| 領域 | 状況 | 実装 |
| --- | --- | --- |
| Payment登録 | 実装済み | 金額、支払い方法、任意の名目、現在時刻、Current Group |
| Payment履歴 | 実装済み | 日付ごとの時系列表示、グループフィルタ |
| Payment編集/削除 | 実装済み | 論理削除、金額・方法・名目・グループ・日時の編集 |
| Group | 実装済み | 作成、詳細、合計、件数、Current Group、削除時の紐付け解除 |
| Payment Method | 実装済み | 追加、名称変更、並び替え、アーカイブ、再表示 |
| Local First | 実装済み | IndexedDBの `payments` / `groups` / `paymentMethods` / `settings` / `outbox` / `syncState` |
| オフライン利用 | 実装済み | Service Worker、通信状態表示、ローカル登録 |
| Sync API | Push実装済み | 認証済み`POST /api/sync/push`でOutboxをPostgreSQLへupsert。未認証・未設定時はOutboxを保持し、Pullは契約のみ |
| 認証 | Issue #1の基盤を実装済み | Auth.js + Google OAuth、Auth.js生成のUUIDユーザーID、未設定時のLocal Only表示、OAuth `accounts`テーブル |
| PostgreSQL/Drizzle | 実装済み | `src/server/db/schema.ts` と `drizzle/` にAuth.jsのユーザー/アカウント、および所有ユーザー、グループ、支払い方法、支払い、ユーザー設定の定義を追加 |
| 自動テスト/CI | 実装済み | IndexedDBの主要フローをVitestで検証し、GitHub Actionsでmise経由のinstall / typecheck / test / buildを実行 |

## 重要な実装判断

- IndexedDBを唯一の入力待ちではなく一次保存先にし、登録時に通信を待たない。
- 変更はOutboxへ記録し、オンライン時に同期APIへ送信する。サーバー未設定でも登録データは失われない。
- Outboxの追加・削除・同期完了は同一ウィンドウの変更イベントで通知し、NetworkStatusのオンライン状態と同期待ち件数を再取得する。
- Groupは必須にせず、削除時はPaymentを削除せず `groupId = null` とする。
- 参照中のPayment Methodは物理削除せず、アーカイブして履歴表示を壊さない。
- Payment Methodは新規入力候補にはactiveのみを使い、ホームと履歴の支払い表示にはアーカイブ済みを含む一覧を使う。
- 認証はAuth.js + Google OAuthとし、アプリ内の`users.id`はAuth.js/Drizzleが生成するUUIDとする。Googleの安定したsubject claimは`accounts`の`provider`と`provider_account_id`で保持する。認証に必要な環境変数またはPostgreSQLが揃わない場合はproviderを有効化せず、Local Onlyで利用できるようにする。
- `users.email`は既存の同期用ユーザー行を壊さないようnullableで追加する。認証情報から正しくbackfillできる移行を定義できるまでは、推測値で埋めたり`NOT NULL`へ変更したりしない。
- セッションはJWT方式とし、Issue #1ではOAuthアカウントリンク用の`accounts`だけを追加する。Push/Pull、所有権チェック、Outboxの初回移行は認証済み同期の別段階で実装する。
- 初回ログインでは既存のIndexedDBデータを削除・統合しない。ログイン後は既存Outboxを認証済みPushの送信対象とし、失敗時は端末に保持する。サーバーデータとの明示的な統合操作は後続段階で追加する。
- Pushはリレーションの順序を保つためGroup、Payment Method、Payment、Settingsの順に処理し、既存のLocal First初期Payment Methodはサーバー側で必要時に作成する。
- Push段階では受信順のupsertを行い、古い更新の勝敗を決める処理は追加しない。cursorとLast Write WinsはPull・競合処理の段階で実装する。
- Entityの更新と対応するOutbox追加は同じIndexedDB readwrite transactionで実行し、Group削除時の関連更新も一括でコミットする。
- サーバー側のIDはクライアント生成値をそのまま保持し、ユーザーごとの複合主キーで初期決済手段IDの衝突を防ぐ。
- Paymentの支払い方法・Group参照はユーザーIDを含む複合外部キーにし、ユーザーをまたぐ参照をDBでも拒否する。
- PWAは192px/512pxのアイコンをマニフェストへ登録し、主要ナビゲーションとNext.jsの静的アセットをService Workerでキャッシュする。Payment/Groupの詳細リンクは表示領域の近くに入った時点で詳細HTMLと参照アセットを順次ウォームし、登録直後のウォームは入力完了を待たずにバックグラウンドで実行する。オフラインの詳細リンクはドキュメント遷移で開く。ナビゲーション、RSC、API、その他のアセットは用途別にオフライン応答を分離し、未キャッシュの動的URLへホームHTMLを誤返却しない。
- Payment登録・編集・論理削除、Group操作、Payment Method管理、Outbox同期の成功/失敗はVitestで継続的に検証し、GitHub Actionsではリポジトリのmise設定を使ってNode 26の同じ検証手順を実行する。

## 残りの実装単位

1. PullのcursorとLast Write Winsを実装する。
2. サーバー変更をIndexedDBへ適用するPull処理と競合検知を追加する。
3. CSV/JSON Export、集計、検索をPhase 2として追加する。
