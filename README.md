# Payment Log

支払った瞬間に、数秒で記録できる個人向け支払いログです。企画書のMVP方針に沿い、金額と支払い方法だけで登録でき、名目・グループは必要なときだけ追加できます。

## 開発

Node.jsはプロジェクトの `mise` 設定または環境で用意したものを使います。

```bash
pnpm install
pnpm dev
```

ブラウザで `http://localhost:3000` を開いてください。初回起動時に支払い方法の初期値（現金、Suica、PayPay、Visa、Mastercard、QUICPay）がIndexedDBへ作成されます。

## 実装済みMVP

- 支払い登録（円整数、支払い方法、任意の名目）
- Current Groupによる自動グループ付与
- IndexedDBへのローカル保存とOutbox記録
- オフライン表示、Service Worker、インストール可能なPWAマニフェスト
- 履歴の日時表示・グループ絞り込み
- 支払いの編集・論理削除
- グループ作成、Current Group設定、詳細・合計、削除時の支払いグループ解除
- 支払い方法の追加、名前変更、並び替え、アーカイブ・再表示

## 同期について

`/api/sync/push` と `/api/sync/pull` はLocal Firstクライアントが利用するAPI契約として用意しています。現状のPushは未設定を表す503を返すため、変更は端末のOutboxに保持されます。本番同期を有効にする際は、企画書にある `users` / `groups` / `payment_methods` / `payments` / `user_settings` とLast Write WinsをDrizzle/PostgreSQLで実装し、認証・所有権チェックを追加します。

詳細な実装判断と未実装項目は [docs/implementation-status.md](docs/implementation-status.md) を参照してください。
