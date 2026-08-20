# Hanabi LOGへの貢献

Hanabi LOGへの改善提案・修正ありがとうございます。変更はできるだけ小さく、目的と確認方法が分かる形で進めてください。

## 基本フロー

1. 既存Issueを確認し、重複がないか確認する
2. 必要に応じてIssueを作成し、目的・背景・完了条件を整理する
3. `main` から作業ブランチを作成する
4. 変更を実装する
5. lint / typecheck / test等で確認する
6. Pull Requestを作成し、関連Issueを記載する
7. レビュー後にマージする

## ブランチ例

```bash
git switch main
git pull
git switch -c feature/report-search
```

修正内容に応じて、以下のような接頭辞を利用してください。

- `feature/`: 新機能
- `fix/`: 不具合修正
- `refactor/`: 挙動を変えない整理
- `docs/`: ドキュメント
- `chore/`: 設定・保守作業

## 開発環境

Node.js 22以上を使用します。

```bash
npm install
cp .env.example .env.local
npm run dev
```

資格情報がない開発環境では、必要に応じて `DEMO_MODE=true` を利用してください。

## 変更前後の確認

基本的に以下を実行してください。

```bash
npm run lint
npm run typecheck
npm test
```

変更範囲が大きい場合やリリース前は、可能であれば次も確認してください。

```bash
npm run build
npm run test:e2e
```

## Pull Requestの方針

- 1つのPRに無関係な変更を混ぜない
- 関連Issueがある場合は `Closes #123` などで紐付ける
- UI変更では、可能であればスクリーンショットを添付する
- データベース変更ではmigrationを追加し、既存データへの影響を書く
- Slack / Notion / Supabase等の外部連携を変更する場合は、失敗時・再試行時の挙動も確認する
- 既存の未コミット変更や他人の作業を勝手に削除しない

## セキュリティ

以下はGitへ追加しないでください。

- `.env.local`
- APIキー、OAuth token、Secret key
- 個人情報
- Private Storageの署名URL
- 実ユーザーの日報本文を含む不要なfixtureやログ

セキュリティ上の問題は公開Issueに詳細を書かず、`SECURITY.md` に従って非公開で共有してください。

## Issueを書くとき

Issueには最低限、以下を含めてください。

- 何が問題か / 何を実現したいか
- なぜ必要か
- 変更範囲
- 完了条件

再現可能な不具合の場合は、再現手順・期待結果・実際の結果も記載してください。
