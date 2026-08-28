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
| Sync API | 契約のみ | `/api/sync/push` と `/api/sync/pull` を用意。Pushは未設定を返しOutboxを保持 |
| 認証 | 未実装 | 本番同期と一緒に追加する |
| PostgreSQL/Drizzle | 実装済み | `src/server/db/schema.ts` と `drizzle/` に所有ユーザー、グループ、支払い方法、支払い、ユーザー設定の定義と初回マイグレーションを追加 |

## 重要な実装判断

- IndexedDBを唯一の入力待ちではなく一次保存先にし、登録時に通信を待たない。
- 変更はOutboxへ記録し、オンライン時に同期APIへ送信する。サーバー未設定でも登録データは失われない。
- Groupは必須にせず、削除時はPaymentを削除せず `groupId = null` とする。
- 参照中のPayment Methodは物理削除せず、アーカイブして履歴表示を壊さない。
- サーバー側のIDはクライアント生成値をそのまま保持し、ユーザーごとの複合主キーで初期決済手段IDの衝突を防ぐ。
- Paymentの支払い方法・Group参照はユーザーIDを含む複合外部キーにし、ユーザーをまたぐ参照をDBでも拒否する。
- PWAアイコンはブランド用アセットが未提供のため、マニフェストでは空配列にしている。本番公開前に192px/512pxのアイコンを追加する。

## 残りの実装単位

1. OAuth方式とユーザー識別子を決定する。
2. Push/Pullの認証、所有権チェック、cursor、Last Write Winsを実装する。
3. サーバー変更をIndexedDBへ適用するPull処理と競合検知を追加する。
4. CSV/JSON Export、集計、検索をPhase 2として追加する。
