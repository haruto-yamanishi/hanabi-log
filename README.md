# Hanabi Log

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

資格情報がない開発環境では `DEMO_MODE=true` によりサンプルデータでUIと基本操作を確認できます。初回デプロイで本番URLを確定する間だけ、一時プレビューにも利用できます。デモには誰でもAdminとしてアクセスできるため、実運用を始める前に必ず `DEMO_MODE=false` と必要な環境変数を設定してください。

起動後、`http://localhost:3000` を開きます。

## Supabaseセットアップ

1. Supabaseでプロジェクトを作成します。
2. SQL Editorで `supabase/migrations/202608190001_hanabi_log.sql` を実行します。
3. 続けて `supabase/migrations/202608190002_private_storage.sql` を実行します。このmigrationがPrivate bucket `hanabi-log-private` を作成し、5 MiBの上限と許可する画像形式を設定します。
4. `supabase/migrations/202608190003_notion_file_upload_state.sql` を実行します。Notion画像同期の再試行に使うFile Upload IDを添付へ保持します。
5. `supabase/migrations/202608200004_notion_oauth_connections.sql` を実行します。Notion OAuthトークンの暗号化保存先を作成します。
6. `supabase/migrations/202608200005_report_likes_and_weekly_digest.sql` を実行します。いいねと週間ベスト配信の保存先を作成します。
7. `supabase/migrations/202608200006_member_activity_and_report_approval.sql` を実行します。Active / Inactiveメンバーと公開承認待ちを追加します。
8. `supabase/migrations/202608200007_report_approval_index.sql` を実行します。承認待ち一覧用のindexを追加します。
9. `supabase/migrations/202608200008_rename_activity_areas.sql` を実行します。活動領域を現在のチーム名称へ移行します。
10. Transaction poolerの接続文字列を `DATABASE_URL` に設定します。
11. Project URLとSecret keyをそれぞれ `SUPABASE_URL`、`SUPABASE_SECRET_KEY` に設定します。

DBとStorageへのアクセスはサーバー側だけに限定します。Secret keyを `NEXT_PUBLIC_` 変数へ設定しないでください。

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

週間ベスト日報をランダムチャットへ送る場合は、Botをそのチャンネルにも参加させ、
チャンネルIDを `SLACK_RANDOM_CHANNEL_ID` に設定します。Bot scopeには、日報チャンネルが
公開なら `channels:history`、非公開なら `groups:history` も必要です。毎週日曜の22時ごろ（JST）に、
その週の公開日報から「いいね最多のベスト投稿」と「Slack返信最多のベストディスカッション」を
1件ずつまとめて配信します。

ログイン時のworkspace IDは `SLACK_TEAM_ID` とサーバー側で照合します。最初のAdminは `ADMIN_SLACK_USER_IDS` にSlack user IDをカンマ区切りで指定します。この設定は初回登録時のbootstrapにだけ使われ、その後に管理画面で変更した権限は再ログインしても保持されます。

Adminは管理画面の「メンバー」で、OBなどをInactiveへ変更できます。Inactiveメンバーはログインと下書き保存はできますが、公開操作は申請になります。申請中の日報は本人とAdminだけが閲覧でき、Adminが「公開承認」で承認した時点でWEBへ公開され、SlackとNotionにも配信されます。既存メンバーと新規ログインしたメンバーは初期状態ではActiveです。

## Notionセットアップ

Notion Developer PortalでOAuth connectionを作成します。内部connectionを作成できないMemberでも、OAuthの許可画面から自分が編集できるdatabaseを選択できます。

1. 認証方法をOAuth、インストール範囲を対象workspaceに限定してconnectionを作成します。
2. Redirect URIに `${APP_BASE_URL}/api/integrations/notion/callback` を設定します。
3. Content capabilityはRead / Insert / Updateを有効にします。
4. Client IDとClient Secretを `NOTION_OAUTH_CLIENT_ID`、`NOTION_OAUTH_CLIENT_SECRET` に設定します。
5. 32 byteのランダム値をbase64化し、`NOTION_TOKEN_ENCRYPTION_KEY` に設定します。この値を変更すると保存済みtokenを復号できなくなるため、secret managerで保持します。
6. 実運用へ切り替えてSlackログイン後、Adminの同期管理から「Notionを接続」を押し、`HANABI LOG｜日報アーカイブ` を選択します。

OAuth callbackは対象databaseのschemaを検証し、不足している `Report UUID` と `アプリURL` だけを追加します。既存propertyの削除やrenameは行いません。Access tokenとRefresh tokenはAES-256-GCMで暗号化してSupabaseへ保存し、Admin以外には返しません。

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

`vercel.json` はVercel Hobbyで利用できるスケジュールとして、毎日03:00 JSTに `/api/cron/integrations`、毎週日曜22:00 JSTに `/api/cron/weekly-best` を呼びます。通常のSlack / Notion同期は日報の公開直後にも実行されます。Productionでは `CRON_SECRET` を必ず設定してください。HobbyのCronは指定時刻から最大1時間ほどずれる場合があります。

## Git運用例

```bash
git switch -c feature/report-search
git add -A
git commit -m "feat: add report search"
git push -u origin feature/report-search
```

秘密情報を含む `.env.local` はGit管理対象外です。token、本文、メール、署名URLをログやfixtureへ追加しないでください。
