このリポジトリは日々の支払いを管理するWEBアプリケーションのリポジトリです


# プロジェクト構成

* docs/: 設計、実装メモ


# コーディング規約

* docsと照らし合わせて不整合を確認し、適宜docsを書き換えること
* 一般に企業で用いられるようなGitとGitHubにおける手順に従うこと
    * プログラムは適宜Gitを使用してCommit & Pushをすること
    * 作業ごとにブランチを切って適切に作業すること
    * `gh` コマンドを使用してIssue機能などを活用すること
    * Issueを作成する際はラベルを活用すること
* いわゆる力技で問題を解決しないこと
    * きれいに解決できない問題がある際にはユーザーに相談すること
* サブエージェントを適宜活用すること

# 開発環境の注意

* 実行環境は `mise` で管理すること
    * `mise` を使用する際は権限が必要なので承認を受けて実行すること


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
