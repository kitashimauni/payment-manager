# Payment Log

支払った瞬間に、数秒で記録できる個人向け支払いログです。企画書のMVP方針に沿い、金額と支払い方法だけで登録でき、名目・グループは必要なときだけ追加できます。

## 開発

Node.js 26.13.1 (LTS)とpnpm 11.21.0はプロジェクトの `mise.toml` で固定しています。

```bash
mise install
mise exec -- pnpm install
mise exec -- pnpm dev
```

ブラウザで `http://localhost:3000` を開いてください。初回起動時に支払い方法の初期値（現金、Suica、PayPay、Visa、Mastercard、QUICPay）がIndexedDBへ作成されます。

## Proxmox LXC / Docker Compose での運用（Issue #36）

非特権LXC（または互換性のあるVM）向けに、Node.js 26.13.1 / pnpm 11.21.0 のマルチステージイメージ、PostgreSQL 17の永続Volume、明示実行するDrizzleマイグレーションを用意しています。初回起動の概要は以下のとおりです。

```bash
cp .env.docker.example .env.docker
chmod 600 .env.docker
# .env.docker のパスワード、DATABASE_URL、APP_IMAGE_TAGなどを編集
docker compose --env-file .env.docker config -q
docker compose --env-file .env.docker build app migrate
docker compose --env-file .env.docker up -d --wait db
docker compose --env-file .env.docker run --rm migrate
docker compose --env-file .env.docker up -d --no-build --wait app
```

ポートは初期状態では `127.0.0.1:3000` にのみ公開され、DBのポートはホストに公開しません。既存リバースプロキシからのHTTPS公開とGoogle OAuthは別途設定が必要です。**実運用に入る前に** [LXCデプロイ・更新・バックアップ/復元手順](docs/deployment-lxc.md) を確認してください。通常の更新で `docker compose down -v` は実行しません。

## Tailscale限定・ログインなしの同期（Issue #38）

`AUTH_MODE=trusted-proxy-single-user` を明示すると、Googleログインを使わず、**Tailnet参加端末だけ**が同じ固定ユーザーIDで同期できます。Local Only と Google OAuth の既存モードも利用できます。これはパスワード不要の公開サービスではありません。**Tailscaleのアクセス制御・同一LXC内の信頼済みHTTPSプロキシ・秘密ヘッダー**が認証境界になります。

1. `.env.docker` に `AUTH_MODE=trusted-proxy-single-user`、`SINGLE_USER_ID`（固定UUID）、`TRUSTED_PROXY_TOKEN`（32バイト以上の乱数をbase64url化）、`TRUSTED_PROXY_ORIGIN`（`https://payments.example.com` のような完全なHTTPS Origin）を設定。Google/E2Eの認証変数は空にする。
2. DB migrationの後、`docker compose --env-file .env.docker run --rm migrate node scripts/bootstrap-single-user.mjs` で固定ユーザーを作成。既存ユーザーのIDを自動転用・統合しない。
3. 同じLXC内のリバースプロキシのみから `127.0.0.1:3000` に接続し、外部からの秘密ヘッダーを**必ず上書き**する。HTTPSの443はTailscale IPにのみbindし、Split DNSとDNS-01証明書、Tailnet ACLを設定する。

詳細な [Tailscale + Nginx設定・疎通試験・復旧手順](docs/deployment-lxc.md#tailscale限定の単一ユーザー同期-issue-38) を必ず確認してください。端末で初めて同期する時は明示確認が必要で、既存の別IDに紐づく端末は自動的に切り替わりません。

## 環境変数

`.env.example`を`.env.local`へコピーして使用します。Local Firstの画面操作には認証用環境変数は必要ありません。

| 変数 | 用途 | 必須 |
| --- | --- | --- |
| `DATABASE_URL` | Drizzleのマイグレーション、認証、同期API | DBを使う場合 |
| `AUTH_MODE` | `auto`（従来互換）/ `google` / `local-only` / `trusted-proxy-single-user` | 省略時は`auto` |
| `SINGLE_USER_ID` | trusted modeの固定UUID | trusted mode |
| `TRUSTED_PROXY_TOKEN` | プロキシが付与する32バイト以上の秘密トークン（base64url） | trusted mode |
| `TRUSTED_PROXY_ORIGIN` | 端末が使う厳密なHTTPS Origin（末尾スラッシュなし） | trusted mode |
| `AUTH_SECRET` | Auth.jsのJWT署名 | Googleログイン / CIの同期E2E時 |
| `AUTH_GOOGLE_ID` | Google OAuth Client ID | Googleログイン時 |
| `AUTH_GOOGLE_SECRET` | Google OAuth Client Secret | Googleログイン時 |
| `E2E_AUTH_USER_ID` / `E2E_AUTH_SECRET` | CI専用の同期E2E用Credentials provider | CIのE2E時のみ |
| `SYNC_TEST_DATABASE_URL` | PostgreSQL統合テストの接続先 | 統合テスト時 |
| `BASE_URL` | Playwright E2Eの接続先 | 接続先を変更する場合 |

`AUTH_MODE=auto`（既定）の場合、`AUTH_SECRET`、`AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET`、`DATABASE_URL`がすべて揃ったときだけGoogleログインを有効にします。不足時はLocal Onlyです。`AUTH_MODE=google` または `trusted-proxy-single-user` の設定不備は**起動エラー**とし、匿名同期へ切り替わりません。

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

CIではPostgreSQLマイグレーション、型検査、Vitest（統合テストを含む）、本番ビルド、ChromiumのPlaywright E2Eをすべて実行します。さらにDocker Composeから独立したPostgreSQLとstandalone本番アプリを起動し、マイグレーション、HTTP/PWAアセット、DB永続化、バックアップ復元を検証します。Playwrightの同期E2EだけはCI専用Credentials providerでテストユーザーを発行し、認証済みのPush/Pullを実際のPostgreSQLに対して検証します。開発の基準ブランチは `main` とし、機能ブランチのPRは原則 `main` をbaseにします。依存する変更をstackする場合は下位PRから順番にマージします。

現在のアプリバージョンは `0.1.0` です。v0.1.0ではLocal First、Google OAuthを設定した同期、JSONバックアップ、主要画面のブラウザE2Eをリリース確認範囲とします。コンテナ構成と運用手順は実装しましたが、Proxmox上での実配備と実Googleアカウントでの運用検証は別作業です。
