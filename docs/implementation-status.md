# 実装状況

企画書 `payment-management-webapp-plan.md` のMVPを、まずサーバー接続なしで価値が成立するLocal First版として実装した。

## 企画書との対応

| 領域 | 状況 | 実装 |
| --- | --- | --- |
| Payment登録 | 実装済み | 金額、支払い方法、任意の名目、現在時刻、Current Group |
| Payment履歴 | 実装済み | 日付ごとの時系列表示、名目・金額・期間・グループ・支払い方法の複合フィルタ、今月・前月・任意期間の集計、表示中Paymentの一括更新・論理削除 |
| Payment編集/削除 | 実装済み | 論理削除、金額・方法・名目・グループ・日時の編集 |
| Group | 実装済み | 作成、詳細、合計、件数、Current Group、削除時の紐付け解除 |
| Payment Method | 実装済み | 追加、名称変更、並び替え、アーカイブ、再表示 |
| データExport/Import | 実装済み | 設定画面からUTF-8 CSV / schemaVersion付きJSONをダウンロードし、JSONは内容確認後に取り込める。Exportは論理削除済みを除外し、Group・Payment Method・Settingsも含める |
| Local First | 実装済み | IndexedDBの `payments` / `groups` / `paymentMethods` / `settings` / `outbox` / `syncState` |
| オフライン利用 | 実装済み | Service Worker、通信状態表示、ローカル登録 |
| Sync API | Push/Pull実装済み | 端末・アカウント確認済みの`POST /api/sync/push`でOutboxをPostgreSQLへupsertし、`GET /api/sync/pull?cursor=...`でユーザー所有の変更をサーバー採番の`sync_version`順で返す。Pull結果はOutboxを生成せずIndexedDBへ適用し、未認証・確認前・未設定時はOutboxを保持する |
| 認証 | Issue #1の基盤を実装済み | Auth.js + Google OAuth、Auth.js生成のUUIDユーザーID、未設定時のLocal Only表示、OAuth `accounts`テーブル |
| PostgreSQL/Drizzle | 実装済み | `src/server/db/schema.ts` と `drizzle/` にAuth.jsのユーザー/アカウント、および所有ユーザー、グループ、支払い方法、支払い、ユーザー設定の定義を追加 |
| 自動テスト/CI | 実装済み | IndexedDBの主要フローとLWWのdelete/update競合をVitestで検証し、Playwrightで主要画面のCRUD、検索/集計、Export/Import、オフライン/PWA、Group・Payment Method履歴、認証済みoffline→online同期を検証。GitHub Actionsでmise経由のinstall / typecheck / test / build / Chromium E2Eを実行。PostgreSQL統合テストでは2デバイスのcursor同期も確認 |

## 重要な実装判断

- IndexedDBを唯一の入力待ちではなく一次保存先にし、登録時に通信を待たない。
- 変更はOutboxへ記録し、オンライン時に同期APIへ送信する。サーバー未設定でも登録データは失われない。
- Outboxの追加・削除・同期完了は同一ウィンドウの変更イベントで通知し、NetworkStatusがオンライン状態と同期待ち件数を再取得する。認証済みでオンラインのOutbox追加時は同イベントから同期も開始し、オンライン復帰直後の一時的な通信失敗は短い遅延で再試行する。
- Groupは必須にせず、削除時はPaymentを削除せず `groupId = null` とする。
- 参照中のPayment Methodは物理削除せず、アーカイブして履歴表示を壊さない。
- Payment Methodは新規入力候補にはactiveのみを使い、ホームと履歴の支払い表示にはアーカイブ済みを含む一覧を使う。
- 履歴の検索はIndexedDBから取得したローカルデータをクライアント側の純粋な絞り込み関数で処理し、論理削除済みを除外する。名目の部分一致、金額範囲、支払日範囲、グループ、支払い方法を組み合わせられ、グループなしとアーカイブ済み支払い方法も選択できる。既存のローカル/リモート変更イベントで履歴を再取得するため、検索条件を保ったまま結果も更新される。
- 支払い集計は検索とは独立した期間（今月、前月、任意期間）でIndexedDBの現在状態から計算する。合計額、件数、平均支払額と、グループ別・支払い方法別の内訳を表示し、グループなしとアーカイブ済み支払い方法を独立した行として保持する。履歴ページがローカル/リモート変更を購読しているため、同期後も集計を再計算する。
- Exportは設定画面でIndexedDBの現在状態から未削除Paymentのスナップショットを作り、通信せずにブラウザのダウンロードを開始する。CSVはUTF-8 BOM付きで全セルを引用し、カンマ・改行・ダブルクォートを含む名目を壊さない。JSONは`schemaVersion: 1`とID、日時、表示用のGroup・Payment Method名を含め、将来のImportで扱える構造にする。Exportは読み取りだけで、EntityやOutboxを変更しない。
- JSON Importはファイル選択後にschemaVersion、必須フィールド、ID、金額、日時、Group・Payment Method参照をランタイム検証し、件数プレビューと明示的な確認操作を要求する。同じIDは`updatedAt`が新しいデータだけを採用し、論理削除も通常更新と同じLWW対象にする。採用したEntityとOutboxは同一IndexedDB readwrite transactionで保存し、途中失敗時に部分適用を残さない。取り込んだローカル変更は既存の同期イベント経由で認証済み同期の対象になる。初期の`schemaVersion: 1`でEntity配列を持たない旧JSONも、Payment内の表示名から参照Entityを復元して取り込む。表示名が不足・衝突する旧データは参照切れを残さないため拒否する。
- 検索の金額条件は入力文字列をそのまま検証し、指数表記などの不正値を別の数値へ変換しない。任意期間が未入力または逆順の間は集計値を有効な値として表示せず、今月・前月の基準日はページ滞在中も定期的に更新する。CSVの自由入力文字列が`=`, `+`, `-`, `@`で始まる場合は、通常の引用処理を維持したままアポストロフィを付けて表計算ソフトの数式評価を防ぐ。
- 認証はAuth.js + Google OAuthとし、アプリ内の`users.id`はAuth.js/Drizzleが生成するUUIDとする。Googleの安定したsubject claimは`accounts`の`provider`と`provider_account_id`で保持する。認証に必要な環境変数またはPostgreSQLが揃わない場合はproviderを有効化せず、Local Onlyで利用できるようにする。
- `users.email`は既存の同期用ユーザー行を壊さないようnullableで追加する。認証情報から正しくbackfillできる移行を定義できるまでは、推測値で埋めたり`NOT NULL`へ変更したりしない。
- セッションはJWT方式とし、Issue #1ではOAuthアカウントリンク用の`accounts`だけを追加する。Push/Pull、所有権チェック、Outboxの初回移行は認証済み同期の別段階で実装する。
- 初回ログインでは既存のIndexedDBデータを削除・統合せず、確認ボタンを押すまでPushもしない。確認後は既存Outboxを認証済みPushの送信対象とし、失敗時は端末に保持する。サーバーデータとの明示的な統合操作は後続段階で追加する。
- Pushはリレーションの順序を保つためGroup、Payment Method、Payment、Settingsの順に処理し、既存のLocal First初期Payment Methodはサーバー側で必要時に作成する。
- 同期対象にはサーバー採番の`sync_version`を付与し、同一ユーザーのPush transactionではtransaction advisory lockを取得して採番順とcommit順を一致させる。Pullはrepeatable readのsnapshotから`sync_version`をopaque cursorとして安定した順序を作る。クライアント由来の`updatedAt`はLWW判定用に残し、cursorの進行には使わない。論理削除も変更として返す。Pull結果はIndexedDBの同一readwrite transactionで各Entityへ適用し、remote applyではOutboxを生成しない。`updatedAt`の新しい変更を優先し、同値では保留中Outboxを持つローカル変更を優先する。Push側にも同じ時刻比較を置き、サーバーの新しい状態を古い更新で上書きしない。Pushで古い更新を無視した場合は現在のサーバーEntityをレスポンスへ返し、cursorを進めずにremote applyしてクライアントを収束させる。
- Entityの更新と対応するOutbox追加は同じIndexedDB readwrite transactionで実行し、Group削除時の関連更新も一括でコミットする。
- 履歴の一括操作は現在の検索結果に含まれるPaymentだけを対象とし、選択状態を明示する。Group変更、Payment Method変更、論理削除の各Payment更新とOutbox追加を一つのIndexedDB readwrite transactionで行い、更新日時は操作単位で揃える。
- ブラウザE2Eの主要フローは実OAuthログインに依存せずLocal Onlyモードで確認し、同期の復帰経路だけはCI専用Credentials providerとPostgreSQL上のテストユーザーで認証済みPush/Pullまで検証する。CIのブラウザサーバーは本番ビルドを`next start`で起動し、ローカルと同じmiseのNode.js 26環境を使う。
- サーバー側のIDはクライアント生成値をそのまま保持し、ユーザーごとの複合主キーで初期決済手段IDの衝突を防ぐ。
- Paymentの支払い方法・Group参照はユーザーIDを含む複合外部キーにし、ユーザーをまたぐ参照をDBでも拒否する。
- PWAは192px/512pxのアイコンをマニフェストへ登録し、主要ナビゲーションとNext.jsの静的アセットをService Workerでキャッシュする。Payment/Groupの詳細リンクは表示領域の近くに入った時点で詳細HTMLと参照アセットを順次ウォームし、登録直後のウォームは入力完了を待たずにバックグラウンドで実行する。オフラインの詳細リンクはドキュメント遷移で開く。ナビゲーション、RSC、API、その他のアセットは用途別にオフライン応答を分離し、未キャッシュの動的URLへホームHTMLを誤返却しない。
- Payment登録・編集・論理削除、Group操作、Payment Method管理、Outbox同期の成功/失敗、Push payload検証、Pull結果のremote applyとLWW判定はVitestで継続的に検証する。Pushの認証ユーザー付与、所有権チェック、upsert、論理削除、transaction rollback、古い更新を保持するLWWはPostgreSQL統合テストでも確認し、GitHub ActionsではPostgreSQLサービスとリポジトリのmise設定を使ってNode 26の検証手順を実行する。

## 残りの実装単位

1. 本番インフラ構築、実Google OAuthアカウントを使った運用検証、v0.1.0公開後の運用改善を行う。
