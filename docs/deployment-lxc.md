# Proxmox LXC + Docker Compose デプロイ手順

Issue #36 の再現可能なデプロイ構成。`compose.yaml` は Next.js アプリ、PostgreSQL 17、単発の Drizzle マイグレーションを分離する。これは **既存の Proxmox ホストへ実際に配備する前の手順**であり、公開 DNS、TLS 証明書、Google OAuth Client の設定は別途行う。

## 1. LXC と Docker の準備

- 原則 **非特権 LXC**、Debian 系ゲストを使用。初期割当の目安は 2 vCPU / 4 GiB RAM（ビルドに余裕を持たせる場合 6–8 GiB）/ 20–32 GiB 以上のディスク。DB・バックアップの増加に合わせて増量する。
- Proxmox 側で LXC を停止し、現在の feature 設定を確認してから `nesting=1`、必要な場合は `keyctl=1` を有効化する。例：`pct config <CTID>`、`pct set <CTID> -features nesting=1,keyctl=1`。既存 feature の上書きに注意する。
- ゲスト内に [Docker Engine と Compose plugin の公式手順](https://docs.docker.com/engine/install/debian/) で導入する。Docker の **rootless mode が必須という意味ではない**（非特権なのは LXC 自身）。
- Proxmox ホストに Docker を直接インストールしない。LXC を特権化したり AppArmor を無効化して問題を回避しない。

動作の事前確認（LXC 内）：

```bash
docker version
docker compose version
docker info --format 'driver={{.Driver}} root={{.DockerRootDir}}'
findmnt -no FSTYPE /
docker run --rm hello-world
```

特に Proxmox が ZFS の場合、LXC 内の backing filesystem と Docker のストレージドライバを確認する。OverlayFS / fuse-overlayfs や cgroup / AppArmor に互換性問題がある場合は、ログを確認して Proxmox の正規の設定範囲で解決する。解決できなければ **同じ Compose 設定を Debian VM に移す**。また、LXC のバックアップ対象・bind mount の扱いはホスト側のストレージ構成で異なる。

## 2. 設定とネットワーク

```bash
git clone https://github.com/kitashimauni/payment-manager.git
cd payment-manager
cp .env.docker.example .env.docker
chmod 600 .env.docker
```

`.env.docker` を編集し、少なくとも以下を設定する。

- `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB` を本番用に変更する。
- `DATABASE_URL` は上記と一致させ、**接続先ホストを `db`** とする（LXC内 `localhost` ではない）。パスワードに URL の予約文字を使う場合は URL 側でパーセントエンコードする。
- `APP_IMAGE_TAG` は `git rev-parse --short HEAD` の結果など、**デプロイするコミット固有の値**に変更する。サンプルの `local` は CI / 試用向けで、更新後のロールバック用には適さない。
- `APP_BIND_ADDRESS=127.0.0.1` は同じ LXC 内にリバースプロキシがある場合の初期値。別 LXC の既存プロキシから接続する場合に限り、この LXC の**特定の内部 IP アドレス**へ変更し、Proxmox / ゲストのファイアウォールで接続元をプロキシに限定する。`0.0.0.0` への無条件公開は避ける。
- `AUTH_SECRET`・`AUTH_GOOGLE_ID`・`AUTH_GOOGLE_SECRET` は未設定なら Local Only のまま動作する。Google OAuth を有効化する場合はこれらと正常な `DATABASE_URL` が必要。`AUTH_URL` は公開 HTTPS の URL、Google Cloud の callback は `https://<公開ドメイン>/api/auth/callback/google` に合わせる。
- リバースプロキシが `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto` を信頼できる値に**設定し直す**ことを確認した場合のみ `AUTH_TRUST_HOST=true` にする（Auth.js は転送ヘッダーを信頼する）。クライアントが任意の値を送り込める設定で有効化しない。

PostgreSQL の `5432` はホストへ公開しない。`db` は Docker の `internal` ネットワークにのみ所属し、`app` は内部DBネットワークとWeb用ネットワークに所属する。本番の TLS 終端は既存リバースプロキシで行う。

**重要：** `http://LXCのIP:3000` は別端末のブラウザでは通常 secure context にならないため、Service Worker とオフライン PWA を正常に使うには HTTPS が必要。`localhost` での動作確認は例外。URL / Origin を変更すると以前の IndexedDB と Outbox は自動で移動されないため、移行前に設定画面の JSON エクスポート、移行後にインポートを検討する（未同期データを特に確認する）。

## 3. 初回起動

以下のコマンドはリポジトリ直下で実行する。`.env.docker` は Git 管理・Docker build context から除外され、Google OAuth や DB の秘密情報はビルド時に渡さない。

```bash
docker compose --env-file .env.docker config -q
docker compose --env-file .env.docker build app migrate
docker compose --env-file .env.docker up -d --wait db
docker compose --env-file .env.docker run --rm migrate
docker compose --env-file .env.docker up -d --no-build --wait app
```

`migrate` は `tools` profile に置いた明示的な一回限りのサービスで、通常の `up` では走らない。`app` は DB の healthcheck を待つが、**マイグレーション完了を自動保証するわけではない**ので、必ず上記の順番に実行する。失敗した場合は新アプリを開始しない。

```bash
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs --tail=100 app db
curl -fsS http://127.0.0.1:3000/ -o /dev/null
curl -fsS http://127.0.0.1:3000/manifest.webmanifest -o /dev/null
curl -fsS http://127.0.0.1:3000/sw.js -o /dev/null
curl -fsS http://127.0.0.1:3000/icons/icon-192.png -o /dev/null
```

`APP_BIND_ADDRESS` を変更した場合は curl のアドレスも合わせる。さらに HTTPS で実際のスマートフォンから支払い登録、再読込、オフライン登録、オンライン復帰後の同期、Google OAuth（設定した場合）を確認する。PWA のブラウザ E2E は既存 Playwright テストも参照する。

## 4. 論理バックアップと復元テスト

PostgreSQL の名前付き Volume `postgres_data` は、コンテナ再作成や通常の `docker compose down` で消えない。ただし **Volume 自体はバックアップではない**。`docker compose down -v` や `docker volume rm` はDBデータを削除するので通常運用で実行しない。

バックアップは `pg_dump` の custom 形式で、カレントディレクトリの `backups/` に権限を制限して保存する。

```bash
bash scripts/backup-postgres.sh .env.docker
ls -lh backups/
```

スクリプトは dump 作成後に `pg_restore --list` で形式を検査し、成功したファイルだけを確定させる。`backups/` は Git と Docker build の対象外。機密性の高い支払い記録を含むので安全な場所に保管し、例えば日次取得・14〜30日分の世代保管を設定する。可能なら暗号化して **LXC の外部**（PBS/別サーバー/安全な保管先）にも複製する。定期ジョブには実行失敗の通知も設定する。Proxmox 側のLXCバックアップも併用し、bind mount が対象に含まれるか確認する。

**復元検証**は、運用DBを直接壊さず、同一PostgreSQL内の空テストDBか別環境で実施する。以下は例（必要容量とバックアップファイルを確認する）：

```bash
docker compose --env-file .env.docker exec -T db \
  sh -c 'createdb -U "$POSTGRES_USER" payment_manager_restore_check'
docker compose --env-file .env.docker exec -T db \
  sh -c 'pg_restore --no-owner --no-acl -U "$POSTGRES_USER" -d payment_manager_restore_check' \
  < backups/＜検証するファイル名＞.dump
docker compose --env-file .env.docker exec -T db \
  sh -c 'psql -U "$POSTGRES_USER" -d payment_manager_restore_check -c "\\dt"'
```

実DBへ復元する場合は **DB全消去を伴う作業**なので、バックアップとLXCスナップショットを検証し、アプリを停止してから行う。以下は操作者が対象名とファイルを再確認した上で実行する例。

```bash
docker compose --env-file .env.docker stop app
# 復元先DBの既存内容は削除される。続行前に対象DBとバックアップを再確認。
docker compose --env-file .env.docker exec -T db \
  sh -ec 'dropdb --if-exists --force -U "$POSTGRES_USER" "$POSTGRES_DB"; createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose --env-file .env.docker exec -T db \
  sh -c 'pg_restore --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < backups/＜復元するファイル名＞.dump
docker compose --env-file .env.docker up -d --no-build --wait app
```

復元後はログ、画面、レコード、認証、同期を確認する。復元は同じアプリとDBスキーマの組み合わせで行うのが安全。実DB復元の緊急時は問題発生前のアプリイメージも合わせて使用する。

## 5. 更新とロールバック

デプロイ前の `APP_IMAGE_TAG` を記録し、旧アプリイメージを削除しない。更新対象コミットは必要なレビュー・CIが通っていることを確認する。

1. `git pull --ff-only` で更新対象コードを取得し、`.env.docker` の `APP_IMAGE_TAG` をそのコミットの短縮SHAなどに変更する（旧タグを控える）。
2. `docker compose --env-file .env.docker build app migrate` で新しいタグのイメージを用意する。この時点では旧アプリを切り替えない。
3. `bash scripts/backup-postgres.sh .env.docker` でDBをバックアップし、ファイルの存在・検査結果・外部への退避を確認する。
4. `docker compose --env-file .env.docker run --rm migrate` を実行する。**失敗したらここで止める**。旧アプリとの後方互換性がないマイグレーションでは、先に `docker compose --env-file .env.docker stop app` して停止時間を取る。
5. 成功したら `docker compose --env-file .env.docker up -d --no-build --wait app` で切り替え、HTTP・PWA・支払い登録/同期をスモークテストする。

アプリの切り戻しが必要なら `.env.docker` の `APP_IMAGE_TAG` を控えた旧タグに戻し、`docker compose --env-file .env.docker up -d --no-build --wait app` を実行する。Compose は保存済みの旧イメージを使用するため、この手順で **再ビルドしない**。ただし **DBスキーマは自動でダウングレードしない**。互換性がない変更ならアプリを停止し、上記のDBバックアップからスキーマ・データを復元して整合性を戻す。復元後の時点以降の更新は失われ得るため、実施前に状況を確認する。

## 6. 日常運用・問題切り分け

```bash
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f --tail=100 app
docker compose --env-file .env.docker stop app
docker compose --env-file .env.docker up -d --no-build app
# 全サービスを停止する場合（Volumeは維持）
docker compose --env-file .env.docker down
```

- **`db` が unhealthy：** `docker compose ... logs db` で権限・ディスク容量・初期パスワードと既存Volumeの不整合を確認する。初期化後に `.env.docker` のDBパスワードだけ変更しても既存DBのパスワードは更新されない。
- **`migrate` が失敗：** マイグレーションを繰り返し実行せず、`DATABASE_URL`、DB起動状態、マイグレーション履歴、互換性を確認する。
- **`app` が unhealthy：** `logs app`、ポート競合、DB接続、メモリ不足を確認。`/` はLocal Onlyでも200応答する設計。
- **Google OAuth の UntrustedHost / callback エラー：** HTTPSの公開URL、`AUTH_URL`、許可済みcallback、proxy側で固定したHost/Forwardedヘッダー、`AUTH_TRUST_HOST` を確認。外部から直接 app:3000 を公開しない。
- **PWA がオフライン動作しない：** HTTPSのsecure context、`/sw.js`、`/manifest.webmanifest`、`/_next/static/` の配信を確認する。サイト URL を変えた場合のIndexedDBは別Originとなる。
- **LXC内で Docker が起動しない：** nesting/keyctl、backing filesystem、cgroup、ストレージドライバを再確認し、必要なら VM 方式へ移行する。

アプリは `unless-stopped` で自動再起動する。DB データは `postgres_data`、ブラウザローカルデータは各端末のIndexedDBにあり、再起動で消える設計ではない。ただし端末のブラウザデータ削除やOrigin変更には別途注意する。
