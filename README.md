# HANABI LOG

FRC Team Hanabiの部内日報を、書きやすく・探しやすく・引き継ぎやすくするWebアプリです。Webアプリを運用データの正本にし、公開した日報の見出しをSlackへ、構造化した本文をNotionへ同期します。

## 主な機能

- Slack OpenID Connectによるチーム限定ログイン
- 日報の下書き、公開、編集、アーカイブ、Adminによる復元
- キーワード、活動領域、カテゴリ、タグ、投稿者、日付、状態による検索
- Supabase Private Storageへの画像保存とHTTPS関連リンク
- Outbox方式によるSlack / Notionの独立同期と再試行
- Member / Adminの所有者・権限チェック
- 390px幅から使えるレスポンシブUI

## 技術構成

- Next.js App Router / TypeScript
- Supabase PostgreSQL / Private Storage
- Auth.js（NextAuth.js）/ Sign in with Slack
- Slack Web API / Notion API `2026-03-11`
- Vercel Hosting / Vercel Cron
- Vitest / Playwright

Firebaseではなく、企画・実装仕様書v0.2で採用されたSupabase + Vercel構成です。実装判断の補足は [docs/decisions.md](docs/decisions.md) を参照してください。

## ローカル起動

Node.js 22以上を使用します。

```bash
npm install
cp .env.example .env.local
npm run dev
```

資格情報がない開発環境では `DEMO_MODE=true` によりサンプルデータでUIと基本操作を確認できます。これはローカル確認専用です。本番では `DEMO_MODE=false` にして、必要な環境変数をすべて設定してください。

起動後、`http://localhost:3000` を開きます。

## Supabaseセットアップ

1. Supabaseでプロジェクトを作成します。
2. SQL Editorで `supabase/migrations/202608190001_hanabi_log.sql` を実行します。
3. 続けて `supabase/migrations/202608190002_private_storage.sql` を実行します。このmigrationがPrivate bucket `hanabi-log-private` を作成し、5 MiBの上限と許可する画像形式を設定します。
4. `supabase/migrations/202608190003_notion_file_upload_state.sql` を実行します。Notion画像同期の再試行に使うFile Upload IDを添付へ保持します。
5. Transaction poolerの接続文字列を `DATABASE_URL` に設定します。
6. Project URLとservice role keyをそれぞれ `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` に設定します。

DBとStorageへのアクセスはサーバー側だけに限定します。service role keyを `NEXT_PUBLIC_` 変数へ設定しないでください。

### 日次バックアップ運用

DatabaseとStorageは別々に、1日1回以上バックアップします。

- **Database:** Pro / Team / EnterpriseではSupabase Dashboardで日次バックアップ（必要に応じてPITR）が有効か毎日監視します。Free環境または追加の退避先が必要な場合は、[`supabase db dump` を使うバックアップ手順](https://supabase.com/docs/guides/platform/backups)を日次ジョブにし、暗号化した別環境へ保存します。
- **Storage:** DatabaseバックアップにはStorageオブジェクト本体が含まれないため、Private bucket `hanabi-log-private` の全オブジェクトを[`supabase storage` またはS3互換クライアント](https://supabase.com/docs/guides/storage/management/download-objects)で日次コピーし、Databaseとは別のPrivateな退避先へ保存します。
- バックアップの保存期間、実行担当、失敗通知を決め、少なくとも月1回はDatabaseとStorageの両方を同じ時点へ復元できることを検証します。dump、画像、資格情報はGitへ追加しないでください。

## Slackセットアップ

Slack Appで、ログイン用OIDCとBot配信を分けて設定します。

1. OAuth redirect URLに `${APP_BASE_URL}/api/auth/callback/slack` を追加します。
2. Sign in with Slackのscopeを `openid profile email` にします。
3. Bot scopeには `chat:write` を付与します。
4. Botを日報チャンネルへ参加させます。
5. workspace ID、Bot token、channel IDを環境変数へ設定します。

ログイン時のworkspace IDは `SLACK_TEAM_ID` とサーバー側で照合します。最初のAdminは `ADMIN_SLACK_USER_IDS` にSlack user IDをカンマ区切りで指定します。この設定は初回登録時のbootstrapにだけ使われ、その後に管理画面で変更した権限は再ログインしても保持されます。

## Notionセットアップ

Notion connectionへ対象databaseを共有し、環境変数を設定してからschemaを確認します。

```bash
npm run notion:check
npm run notion:migrate
npm run notion:check
```

`notion:migrate` が追加するのは不足している `Report UUID` と `アプリURL` だけです。既存propertyの削除やrenameは行いません。

## 品質確認

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Playwrightブラウザをインストール済みの環境では、次も実行できます。

```bash
npm run test:e2e
```

## Vercelデプロイ

1. GitHub等へこのリポジトリをpushします。
2. VercelでリポジトリをImportします。
3. `.env.example` の変数をPreview / Productionへ設定します。
4. `DEMO_MODE=false` を設定します。
5. Productionへデプロイします。
6. 本番URLを `APP_BASE_URL` とSlack redirect URLへ反映し、再デプロイします。

`vercel.json` はVercel Hobbyで利用できる1日1回（03:00 JST）のスケジュールで `/api/cron/integrations` を呼び、同期失敗を再試行します。通常のSlack / Notion同期は日報の公開直後にも実行されます。Productionでは `CRON_SECRET` を必ず設定してください。より短い間隔で自動再試行したい場合は、Vercel Proでscheduleを変更するか、同じendpointをBearer token付きで呼ぶ外部schedulerを利用してください。

## Git運用例

```bash
git switch -c feature/report-search
git add -A
git commit -m "feat: add report search"
git push -u origin feature/report-search
```

秘密情報を含む `.env.local` はGit管理対象外です。token、本文、メール、署名URLをログやfixtureへ追加しないでください。
