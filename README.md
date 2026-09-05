# Payment Log

支払った瞬間に、数秒で記録できる個人向け支払いログです。企画書のMVP方針に沿い、金額と支払い方法だけで登録でき、名目・グループは必要なときだけ追加できます。

## 開発

Node.js 26.8.1とpnpm 11.21.0はプロジェクトの `mise.toml` で固定しています。

```bash
mise install
mise exec -- pnpm install
mise exec -- pnpm dev
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

## 認証（Issue #1）

認証基盤はAuth.js + Google OAuthです。`AUTH_SECRET`、`AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET`、`DATABASE_URL`の4つがすべて設定されている場合だけログインを有効にします。いずれかが未設定、または認証用データベースが一時的に利用できない場合は、画面に `Local Only` を表示してローカル記録をそのまま利用できます。

Google Cloud側の承認済みリダイレクトURIには、開発時は次を登録してください。

```text
http://localhost:3000/api/auth/callback/google
```

`AUTH_SECRET`はNode.js 26で生成できます。

```bash
mise exec -- node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Googleのsubject claimを`google:<sub>`へ変換した値を`users.id`に保存します。provider名を含めることで、将来別のOAuth providerを追加しても識別子が衝突しません。初回ログイン時に既存のIndexedDBデータを自動アップロード・削除・統合することはありません。データ移行は、認証済み同期を実装する段階で明示的な操作として追加します。

## 同期について

`/api/sync/push` と `/api/sync/pull` はLocal Firstクライアントが利用するAPI契約として用意しています。認証は導入済みですが、Push/Pullはまだ実装していないため、現状のPushは未設定を表す503を返し、変更は端末のOutboxに保持されます。本番同期を有効にする際は、企画書にある `users` / `groups` / `payment_methods` / `payments` / `user_settings` とLast Write WinsをDrizzle/PostgreSQLで実装し、認証・所有権チェックを接続します。

詳細な実装判断と未実装項目は [docs/implementation-status.md](docs/implementation-status.md) を参照してください。

## PostgreSQL / Drizzle

PostgreSQLのテーブル定義は `src/server/db/schema.ts`、初回マイグレーションは `drizzle/` にあります。接続先を `.env.local` の `DATABASE_URL` に設定して実行します。

```bash
cp .env.example .env.local
# .env.local の DATABASE_URL を接続先に変更
pnpm db:check
pnpm db:migrate
```

スキーマを変更した場合は、次のコマンドで新しいマイグレーションを生成します。

```bash
pnpm db:generate
```
