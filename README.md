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

## 環境変数

`.env.example`を`.env.local`へコピーして使用します。Local Firstの画面操作には認証用環境変数は必要ありません。

| 変数 | 用途 | 必須 |
| --- | --- | --- |
| `DATABASE_URL` | Drizzleのマイグレーション、認証、同期API | DBを使う場合 |
| `AUTH_SECRET` | Auth.jsのJWT署名 | Googleログイン時 |
| `AUTH_GOOGLE_ID` | Google OAuth Client ID | Googleログイン時 |
| `AUTH_GOOGLE_SECRET` | Google OAuth Client Secret | Googleログイン時 |
| `SYNC_TEST_DATABASE_URL` | PostgreSQL統合テストの接続先 | 統合テスト時 |
| `BASE_URL` | Playwright E2Eの接続先 | 接続先を変更する場合 |

`AUTH_SECRET`、`AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET`、`DATABASE_URL`は、Googleログインを有効にする場合にすべて設定してください。未設定の変数がある場合はLocal Onlyで起動します。

## 実装済みMVP

- 支払い登録（円整数、支払い方法、任意の名目）
- Current Groupによる自動グループ付与
- IndexedDBへのローカル保存とOutbox記録
- オフライン表示、Service Worker、インストール可能なPWAマニフェスト
- 履歴の日時表示・名目、金額、期間、グループ、支払い方法による複合検索
- 今月・前月・任意期間の支払い集計、グループ別・支払い方法別の内訳
- 履歴の表示中Paymentに対するグループ・支払い方法の一括変更、論理削除
- 設定画面からのCSV/JSONエクスポート（論理削除済みを除外）
- 設定画面からのJSONバックアップ取込（内容プレビュー、更新日時による競合解決、Outbox連携）
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

アプリ内の`users.id`はAuth.js/Drizzleが生成するUUIDとし、Googleのstable subjectは`accounts.provider = google`と`accounts.provider_account_id`の組み合わせで保持します。初回ログイン後も、確認ボタンを押すまで既存のIndexedDBデータをサーバーへ送信しません。確認後は既存Outboxをこのアカウントへ送信しますが、データの削除や統合は行いません。

## 同期について

`/api/sync/push` は、端末とアカウントの紐付けを確認した認証済みユーザーのOutboxをPostgreSQLへ一方向同期します。未ログイン、確認前、認証設定未完了、またはサーバー未設定の場合はエラーまたは送信停止となり、クライアントはOutboxを保持します。Pushでは `users` / `groups` / `payment_methods` / `payments` / `user_settings` をサーバー側の`user_id`でupsertします。古い更新をサーバー側で無視した場合は、現在のサーバーEntityをレスポンスにも含めてクライアントを収束させます。

`/api/sync/pull?cursor=...` は、同じ認証済みユーザーの変更をサーバー採番の `sync_version` 順で返します。cursorはopaqueなページング値で、論理削除も変更として含まれます。`updatedAt` はクライアント間のLWW判定用に保持し、cursorの進行には使用しません。クライアントはPull結果をIndexedDBへremote applyし、Outboxを生成せずに画面へ反映します。ローカルより新しい変更を優先し、保留中のローカル変更がある場合は古いリモート変更を保持します。Push側でもサーバーの新しい状態を古い更新で上書きしません。

詳細な実装判断と未実装項目は [docs/implementation-status.md](docs/implementation-status.md) を参照してください。

## PostgreSQL / Drizzle

PostgreSQLのテーブル定義は `src/server/db/schema.ts`、初回マイグレーションは `drizzle/` にあります。接続先を `.env.local` の `DATABASE_URL` に設定して実行します。

```bash
cp .env.example .env.local
# .env.local の DATABASE_URL を接続先に変更
mise exec -- pnpm db:check
mise exec -- pnpm db:migrate
```

スキーマを変更した場合は、次のコマンドで新しいマイグレーションを生成します。

```bash
mise exec -- pnpm db:generate
```

## テストとリリース運用

Node.js 26のmise環境で、次の順にローカル検証できます。

```bash
mise exec -- pnpm typecheck
mise exec -- pnpm test
mise exec -- pnpm db:check
mise exec -- pnpm build
mise exec -- pnpm exec playwright install chromium
mise exec -- pnpm test:e2e
```

CIではPostgreSQLマイグレーション、型検査、Vitest（統合テストを含む）、本番ビルド、ChromiumのPlaywright E2Eをすべて実行します。GitHubの既定ブランチは現在 `codex-init-project` です。機能ブランチのPRは、依存するPRをbaseにしてstackし、下位PRから順番にマージします。#26→#27→#28→#29の順でマージ後、必要に応じて既定ブランチを変更します。

現在のアプリバージョンは `0.1.0` です。v0.1.0ではLocal First、Google OAuthを設定した同期、JSONバックアップ、主要画面のブラウザE2Eをリリース確認範囲とし、本番インフラ構築と実Googleアカウントでの運用検証はリリース後の作業とします。
