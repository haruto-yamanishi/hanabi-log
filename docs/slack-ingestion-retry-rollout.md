# Slack ingestion retry / dead-letter rollout

Slackの取り込みqueueへretry / dead-letter stateを追加する変更は、application deployとDB migrationの順序が逆転してもWebhook処理を壊さないよう段階導入します。

## Mode

`SLACK_INGESTION_RETRY_MODE`は次の2値です。

- `off`（未設定時のdefault）: 既存schemaだけを使う。`attempts` / `available_at` / `last_error` / `dead_at`列へアクセスしない。
- `enforce`: retry / backoff / dead-letter処理を有効化する。

不明な値はconfiguration errorにします。

## Safe deployment order

1. `SLACK_INGESTION_RETRY_MODE`を未設定または`off`のままapplication codeをdeployする。
2. 本番DBへ`supabase/migrations/202609070007_slack_incoming_retry_state.sql`を適用する。
3. 両tableに`attempts`、`available_at`、`last_error`、`dead_at`が存在することを確認する。
4. `SLACK_INGESTION_RETRY_MODE=enforce`を設定してredeployする。
5. 新しいSlack eventが通常処理されることを確認する。
6. 一時失敗がbackoffされ、恒久失敗がdead-letter化されることを管理query/health UIで確認する。

Migration適用前に`enforce`へ切り替えてはいけません。

## Rollback

Application側で問題が起きた場合は、まず`SLACK_INGESTION_RETRY_MODE=off`へ戻してredeployします。追加DB列は後方互換なので、即座にdropする必要はありません。
