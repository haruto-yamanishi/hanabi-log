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

添付の検証結果を保存するため、`supabase/migrations/202609080002_upload_verification_json.sql` も適用します。非公開バケットでは内部処理用の `application/json` を許可する必要があります。これが欠けると「アップロード検証結果を保存できませんでした」となります。ユーザーが添付できる形式は画像・動画のみです。

DBとStorageへのアクセスはサーバー側だけに限定します。Secret keyを `NEXT_PUBLIC_` 変数へ設定しないでください。

### 日次バックアップ運用

DatabaseとStorageは別々に、1日1回以上バックアップします。

- **Database:** Pro / Team / EnterpriseではSupabase Dashboardで日次バックアップ（必要に応じてPITR）が有効か毎日監視します。Free環境または追加の退避先が必要な場合は、[`supabase db dump` を使うバックアップ手順](https://supabase.com/docs/guides/platform/backups)を日次ジョブにし、暗号化した別環境へ保存します。
- **Storage:** DatabaseバックアップにはStorageオブジェクト本体が含まれないため、Private bucket `hanabi-log-private` の全オブジェクトを[`supabase storage` またはS3互換クライアント](https://supabase.com/docs/guides/storage/management/download-objects)で日次コピーし、Databaseとは別のPrivateな退避先へ保存します。
- バックアップの保存期間、実行担当、失敗通知を決め、少なくとも月1回はDatabaseとStorageの両方を同じ時点へ復元できることを検証します。dump、画像、資格情報はGitへ追加しないでください。

## 登録済みメンター用Google認証

Slackのゲストなど、Slack認証を利用できないメンター向けにGoogle認証を追加できます。
許可するメールアドレスはサーバー側の環境変数で管理します。管理画面での登録には対応していません。

1. Google CloudでOAuthクライアント（ウェブアプリケーション）を作成し、承認済みリダイレクトURIに `${APP_BASE_URL}/api/auth/callback/google` を登録します。
2. OAuth同意画面を設定します。外部向けでテスト中の場合は、対象メンターをテストユーザーにも登録します。
3. `GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET` を設定します。
4. `GOOGLE_MENTOR_ACCOUNTS` にメールアドレスと対象ワークスペースの実際のSlackメンバーIDのJSONを設定します。例: `{"mentor@example.com":"U0123456789"}`。SlackのプロフィールからメンバーIDをコピーし、本人のIDであることを確認してください。
5. 再デプロイするとログイン画面にGoogleボタンが表示されます。

Googleが確認済みとしたメールだけを完全一致で許可します（前後の空白・大文字小文字は正規化）。
Gmailのドットや `+alias`、ドメイン単位の許可は展開しません。不正な設定や未登録メールは拒否します。
メールアドレスを削除または紐づけ先を変更して再デプロイすると、既存Googleセッションも次のサーバー側認証確認で無効になります。
既存のSlackメンバーと同じ投稿・権限・Active状態を使用し、新規登録時は通常メンバーになります。
Googleログイン時に表示名・メール・アバターはGoogleの情報へ更新されます。
Google認証はSlack自体のチャンネル閲覧権限を変更しません。

仕様参考: [NextAuth Google provider](https://next-auth.js.org/providers/google)

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

## Slackへの直接投稿を日報として取り込む

日報チャンネルの新しい本文付き投稿を、自動でWebの日報として登録します。書式の指定は不要です。
本文全体を「今日やったこと」、活動領域を「その他」、内容カテゴリを「進捗」として保存し、
投稿日（日本時間）を日報の日付にします。Activeメンバーは公開・日報実績への計上・Notion同期まで自動で進み、
Inactiveメンバーは従来どおり承認待ちになります。Web未ログインの投稿者もSlack IDで登録し、後のログイン時に同じメンバーへ紐づきます。

有効化手順:

1. `supabase/migrations/202609060001_slack_incoming_reports.sql` をDBへ適用し、アプリをデプロイします。
2. Slack AppのBasic InformationにあるSigning Secretを、環境変数 `SLACK_SIGNING_SECRET` に設定して再デプロイします。
3. Bot scopeに `users:read` と、公開チャンネルなら `channels:history`、非公開なら `groups:history` を追加し、ワークスペースへ再インストールします。
4. Event Subscriptionsを有効にし、Request URLを `${APP_BASE_URL}/api/integrations/slack/events` にします。
5. Subscribe to bot eventsに公開なら `message.channels`、非公開なら `message.groups` を登録します。Botは `SLACK_CHANNEL_ID` のチャンネルに参加させてください。

[Slack公式のEvents API仕様](https://docs.slack.dev/apis/events-api/)に合わせ、署名を確認し、受信をDBへ保存して応答した後に取り込みます。
重複したイベントでも日報は増えません。処理失敗時は受信データを残し、次のイベント受信時または既存の毎日Cronで再試行します。
Bot投稿、スレッド返信、本文のない投稿は対象外です。過去投稿の一括取り込み、添付ファイルのコピー、Slack上の削除の追従は行いません。
Webで取り込んだ日報を編集・削除しても、本人が書いたSlack原文は保持します。


### Slackの本文編集・スタンプ同期

追加マイグレーション `supabase/migrations/202609070001_slack_edits_and_reactions.sql` を適用してデプロイしてください。
Slack AppでBot scopeに `reactions:read` を追加して **Reinstall to Workspace** を行い、
Event Subscriptionsのbot eventsへ `reaction_added` と `reaction_removed` を追加して保存します。
本文編集は既存の `message.channels` / `message.groups` で受信できます。**Socket Modeはオフ**にしてください。
イベントと権限は[Slack公式のreaction_added仕様](https://docs.slack.dev/reference/events/reaction_added/)に従います。

- Slackから取り込んだ投稿の本文編集は、同じWeb日報の本文・要約へ反映し、Notionも更新します。日付・分類・承認状態は維持し、活動実績は増やしません。
- 日報に紐づいたSlackの親投稿とコメント（スレッド返信）へのスタンプは、種類を問わずいいねとして数えます。WebからSlackへ配信した日報も対象です。
- 同じ人の複数スタンプとWebのいいねは合計1件。スタンプをすべて外してもWebのいいねが残れば1件を維持し、逆も同様です。
- WebのボタンはWeb側のいいねを操作し、人数とメンバー一覧はSlackとの合計を表示します。同じ人が親投稿・複数コメント・Webで押しても、日報全体で1人1件です。一部を解除しても別の場所にいいねが残っていれば維持します。
- 過去のスタンプは、管理画面の「同期管理」から一括取り込みできます。通常は追加・削除イベントで反映します。

必要な場合のローカルDB検証（空のローカルPostgreSQLテストDBを指定。本番の `DATABASE_URL` は使いません）:

```bash
SLACK_SYNC_TEST_DATABASE_URL=postgres://USER@127.0.0.1:PORT/EMPTY_TEST_DB npm run test -- src/server/integrations/slack-sync-db.test.ts
```


### 過去スタンプの取り込み・いいねのDM通知

`supabase/migrations/202609070002_like_notifications.sql` を適用してデプロイします。
追加の環境変数は不要です。既存の `reactions:read`・`users:read`・`chat:write` と、コメント表示で使う履歴閲覧権限（`channels:history` / `groups:history`）を使用します。

管理画面 → 同期管理 → **過去のスタンプを取り込む** を押すと、Web日報に紐づいたSlackの親投稿とスレッド返信を順番に取り込みます。
画面を閉じたりエラーで止まった場合も、再度押すと未取得分から再開します。Slackイベントで受信済みの追加・削除を優先し、Webいいねは維持します。
対象はSlackから現在取得できるスタンプです。[reactions.get](https://docs.slack.dev/reference/methods/reactions.get/)に `full: true` を指定し、
返されたユーザー数がスタンプ人数に足りない場合は、重複人数を推測せずエラーにします。

公開日報のいいねが **5・10・20・30人を超えたとき（6・11・21・31人）**、その日報の投稿者にSlack DMを送ります。
WebとSlackの合計人数を使い、同じ日報の同じ節目はDBに一度だけ登録します。
過去スタンプの取り込みや既存いいねも対象で、一度に複数の節目を超えた場合は最高の節目を1通で通知します。
通知の送信失敗は記録を残し、5分経過後のイベント受信・Webいいね・既存Cronで再試行します。
送信状況はSupabaseの `report_like_notifications`（`sent_at`・`last_error`）とVercelログの `Slack like milestone DM failed` で確認できます。


### 管理画面でDM通知履歴を確認する

`supabase/migrations/202610170002_system_dm_deliveries.sql` を適用してデプロイすると、
管理画面 → 同期管理 → **システムのDM送信履歴** で、いいね通知・活動リマインド・お知らせをまとめて最新100件まで確認できます。
宛先・種類・本文・送信日時・状態・エラーを表示します。「履歴を更新」で最新状態を取得します。
新しいDMは共通の `sendSystemDm` を通し、送信前に宛先と本文を保存します。送信成功済みの同じキーは再送しません。
送信後の保存に失敗した記録は自動で再送せず「送信結果の確認が必要」と表示します。
既存のいいね通知と活動リマインドの監査記録も統合します。過去に保存していない本文は未保存と明示します。
履歴はAdmin限定です。新しい共通履歴は日報削除後も保存されます（旧いいね履歴は従来どおり日報とともに削除）。


## コメントのスタンプを日報のいいねへ合算する変更

本番反映前に `supabase/migrations/202610160001_comment_reaction_likes.sql` を適用してください。
SlackイベントのメッセージIDから返信先を取得して、対応する日報のいいねへ合算します。
集計値・いいねしたメンバー・ランキング・節目通知は、共通の `report_likes` を使います。

過去分は管理画面の「過去のスタンプを取り込む」で再取り込みできます。以前に親投稿だけを
取り込み済みの日報も対象です。返信を5件ずつ取得し、ページの進捗を保存するため再開できます。
新しい追加・削除イベントは過去分より優先し、人数が取得しきれない場合は推測せず停止します。
返信先の取得に失敗したイベントは5分後以降に再試行し、日報が後から取り込まれた場合も集計します。
日報が存在する間は、スタンプの最新状態と解除記録を定期削除せず保持します。

Slack仕様: [reactions.get](https://docs.slack.dev/reference/methods/reactions.get/) /
[conversations.replies](https://docs.slack.dev/reference/methods/conversations.replies/)

追加で `202610170001_unavailable_reaction_threads.sql` を適用すると、Slackが
`thread_not_found` / `message_not_found` を返すスレッドを失敗として記録して、
残りの取り込みを続行します。管理画面に除外件数を表示し、取り込み済みとは区別します。
権限不足・レート制限・通信障害は除外せず、従来どおり再試行できます。

### Slack画像・動画と過去日報の修復（2026-10）

`202610230001_report_media_and_categories.sql` と `202610230002_mov_storage.sql` を適用します。Slack Botに
`files:read` を追加してワークスペースへ再インストールしてください。
Web動画はMP4 / WebM / MOV（47MiBまで）に対応しています。
Slack返信の添付は、コメント取得時に非公開Storageへ保存して表示します。
取得できなかった添付は本文を隠さず未取得と表示します。

Slackカードの画像は、公開中の添付に限定した専用URLを使用します。
画像を削除したり日報をアーカイブするとアクセスを拒否します。
URLは画像へのアクセス権を含むため、ログや公開資料へ転載しないでください。
再投稿時は既存Slackカードを照合し、投稿IDを本文スレッド・Notion同期より先に保存します。

過去の直接投稿・添付・返信・スタンプを再開可能な形で移行できます。
まず `--apply` なしで対象件数を確認してください。実行時はデモ設定を必ず無効化します。
移行は日報チャンネルのユーザーの親投稿を対象とし、Bot投稿・システム通知・返信を日報として重複登録しません。

```bash
DEMO_MODE=false node --env-file=.env.local --conditions=react-server --import tsx scripts/slack-repair.ts
DEMO_MODE=false node --env-file=.env.local --conditions=react-server --import tsx scripts/slack-repair.ts --apply
```

`--repair-messages` を追加すると既存のWeb由来Slackカードの画像URLも更新します。
50MBを超える過去動画は `scripts/slack-compress-history.ts` でWeb用コピーを圧縮できます
（ffmpeg / ffprobeが必要、Slackの元動画は維持）。その後もう一度取り込みを実行してください。
`slack_incoming_reports.media_error` に添付の未取得理由を保存します。

### コメントいいねと下書きプレビュー

`202610230003_comment_likes.sql` を適用します。Webコメントのいいねは独立した状態として保存し、
Slackの複数スタンプ・WebとSlackの重複をコメントごとに1人1件へまとめます。
日報には同じ人から最大1件、コメント投稿者のランキングには各コメントで受けた件数を加算します。
日報投稿者とコメント投稿者が同じ場合は同じ人に二重加算しません。
一方のサービスで解除しても、他方のいいねは残ります。
過去コメントの投稿者情報も `slack-repair.ts --apply --comments-only` で取り込めます。

下書き編集では、追加した画像と動画をその場でプレビューできます。動画は再生・シーク可能です。
保存した下書きを開き直した場合も、非公開Storageからプレビューを取得します。

### 本文メンション・並び順・利用状況（2026-10-23）

本文の各入力欄で `@` を入力するとSlackメンバー候補が開きます。表示名・本名・ユーザー名を
NFKC、大小文字、空白、かなを正規化して検索します。保存値はSlack ID付きのトークン、
編集時の表示は `@名前` です。名前そのものを編集した場合は通知対象から外します。
アーカイブの `sort` は `newest`（既定）・`oldest`・`popular`。人気順は日報のいいね人数で、
同数の場合は公開日時・IDの降順です。カーソルには並び順といいね数も保持します。

`202610230004_usage_analytics.sql` を適用してから新バージョンをデプロイします。
管理者専用 `/api/admin/analytics` から、登録日時、最終アクセス、オンラインの目安、
日報別PV・閲覧者数を確認できます。オンラインは表示中のタブが60秒ごとに送る通信が
直近2分以内にあった状態です。タブを隠したり閉じた場合は2分以内にオフラインになります。
IPアドレスや閲覧パスは保存しません。閲覧は日報ID・メンバーID・訪問ID・日時を保持します。
詳細画面の表示後に計測し、同じ訪問IDの再送は重複加算しません。再読み込みや投稿者自身の閲覧は
PVに含め、同じ人の閲覧者数は1人とします。下書き・承認待ちは計測しません。
計測開始日時はDBに保存し、開始前のPVを推測で補完しません。

`/updates` にパッチノートとクレジットを掲載しています。

### Slack内の動画再生

`202610230005_slack_video_uploads.sql` を適用し、Slackアプリの **Bot Token Scopes** に
`files:write` を追加して再インストールします。**User Token Scopes** の `openid` / `profile` /
`email` と `files:write` を混在させないでください（ログイン用とBot用は別の認証フローです）。

Web日報の動画は、親投稿のスレッドへSlackネイティブのファイルとして配信します。
getUploadURLExternal → バイナリアップロード → completeUploadExternal を使い、ファイルIDを
共有前にDBへ保存します。完了応答が失われても同じIDの共有状態を照合し、再アップロードしません。
動画の削除・日報のアーカイブ時は、この連携が作ったSlackファイルだけを削除します。
Slackから取り込んだ元投稿・元動画は変更しません。配信された動画をWebコメントとして再取り込みしません。
Slackの動画処理が終わるまで、プレーヤーが表示されるまで時間がかかる場合があります。

過去のWeb日報の動画を配信するには、まずdry-runで対象を確認し、`--apply` を追加します。

```bash
DEMO_MODE=false APP_BASE_URL=https://log.9494hanabi.com node --env-file=.env.local --conditions=react-server --import tsx scripts/slack-sync-videos.ts
```

本文メンションはSlackユーザーグループにも対応しています。Slackアプリの **Bot Token Scopes** に
`usergroups:read` を追加し、再インストールします。候補にはグループ名・ハンドル・人数を表示し、
`@[名前](slack:S...)` として保存して、Slack投稿時に `<!subteam^S...>` へ変換します。
個人メンションは従来どおり利用でき、グループの権限不足は候補内に表示します。
コメント欄は表示中に30秒ごとに更新します。動画再生中・コメント送信中は自動更新を待ちます。

過去のパッチノートはコミット日付から復元しました。掲載内容と根拠のコミットは
[docs/release-history.md](docs/release-history.md) に記録しています。

### メディア一覧

`/media` は公開・アーカイブ済みの日報とコメントの写真・動画をまとめて表示します。日報の日付順に24件ずつ読み込み、種類・添付先で絞り込めます。下書き・承認待ちは含めません。アーカイブ済みの日報は既存の閲覧権限に合わせて投稿者本人とAdminにだけ表示します。ファイルURLはアクセス時にログインと現在の添付情報を照合して発行します。

本番反映前に `supabase/migrations/202610230006_media_gallery.sql` を適用します。過去のコメントとの紐づきは `DEMO_MODE=false node --env-file=.env.local --conditions=react-server --import tsx scripts/slack-index-comment-media.ts --apply` で復元できます（Slackへの投稿は行いません）。今後のSlack返信・編集・削除はEvents APIで同期予約し、イベント後処理と既存のcronで取り込みます。コメント閲覧時にも最新の添付情報を保存します。


### 掲載許可・校正確認

権限変更DMには `202610240002_member_role_notifications.sql` も適用します。管理画面からの権限変更と通知予約を同じトランザクションで保存し、変更したAdminのSlackメンションを含めて本人へ通知します。同じ権限の再指定では通知しません。送信失敗はintegrations cronで再試行し、管理画面の通知履歴に記録します。

`202610240001_publication_permissions.sql` を適用してからデプロイします。Adminは管理画面でメンバーに `media` 権限を割り当てられます。Mediaは他人の日報の編集・承認・管理権限を持たず、掲載依頼と自分の依頼に対する校正原稿の送付ができます。Adminは同じ機能を利用できますが、日報投稿者の代わりに掲載を許可することはできません。

日報詳細から掲載先を複数選択して依頼すると、本文・添付名と日報の版を保存します。Slack DMのボタンからSlack内のモーダルを開き、掲載許可・校正指示・本文とURLの提出・最終承認・修正依頼・拒否まで操作できます。本人がモーダルの「送信」を押して初めて確定します。署名・ワークスペース・現在のメンバー権限・依頼の版を検証し、Webと同じ状態遷移と履歴を利用します。

Slackアプリの **Interactivity & Shortcuts** をOnにし、Request URLに `https://log.9494hanabi.com/api/integrations/slack/interactions` を設定します。`SLACK_SIGNING_SECRET` と既存のBotトークンを使用し、追加OAuthスコープは不要です。既存DMのリンクボタンは `node --env-file=.env.local --import tsx scripts/upgrade-publication-slack-buttons.ts --apply` で同じメッセージ上のSlack操作ボタンへ変更できます（`--apply` なしは件数確認のみ）。

原文のまま許可された場合は依頼時の原文が対象です。自分で校正・校正依頼の場合は条件付きの許可として、担当者が本文と確認用URLを提出し、本人が最終確認します。修正依頼・再提出・拒否も記録します。外部メディアへの自動投稿は行いません。確認URLには公開前の共有プレビュー等を利用してください。

依頼・返信とDM送信予約を同じDBトランザクションで保存します。DMはレスポンス後と既存cronで処理し、送信失敗は5分間隔で最大8回試行します。Slackが受け付けたか不明な送信を二重送信しない既存の仕組みも使用します。送信状態・本文・宛先は管理画面のDM履歴で確認できます。
