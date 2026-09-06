# API rate limits

Hanabi LOGはVercelの複数instance間でも共有できるよう、PostgreSQLの原子的fixed-window counterでAPI rate limitを適用します。process memoryだけのcounterは使用しません。

## Default limits

1ユーザーあたり1分:

| Bucket | Default | Examples |
| --- | ---: | --- |
| read | 120 | report/member/comment reads |
| write | 30 | report create/edit/delete/publish, comments |
| upload | 12 | signed upload URL issuance |
| reaction | 60 | like/unlike |
| admin | 20 | role/activity/member deletion, integration administration |
| integration | 10 | Slack/Notion manual retry |

同じnetwork identityには各member limitの4倍を適用します。これにより単一ユーザーだけでなく、多数accountを使った同一networkからのburstにも上限を設けます。

## Identity privacy

DBにはmember IDやIP addressそのものをrate-limit keyとして保存しません。`AUTH_SECRET`をkeyにしたHMAC-SHA-256だけを`api_rate_limit_windows.key_hash`へ保存します。

IPはVercel/reverse proxyが設定するforwarded headerをtrust boundaryとします。自己hostする場合は、公開Internetからアプリへ直接到達できないようtrusted proxyを前段に置き、forwarded headersをproxy側で上書きしてください。

## Response

制限超過時はHTTP `429`、error code `RATE_LIMITED`を返し、次のfixed windowまでの秒数を`Retry-After` headerで通知します。

Clientは429を即時連打せず、最低でも`Retry-After`だけ待ってから再試行してください。

## Configuration

以下のenvironment variableでmember limitを変更できます。

- `RATE_LIMIT_READ_PER_MINUTE`
- `RATE_LIMIT_WRITE_PER_MINUTE`
- `RATE_LIMIT_UPLOAD_PER_MINUTE`
- `RATE_LIMIT_REACTION_PER_MINUTE`
- `RATE_LIMIT_ADMIN_PER_MINUTE`
- `RATE_LIMIT_INTEGRATION_PER_MINUTE`

1〜100000の整数以外は安全なdefaultへ戻ります。通常は個別endpointでlimitを緩める前に、実測トラフィックと429発生率を確認してください。

## Retention

counterは1分window単位で作成され、1日を超えた行は既存のoperational retention jobからbounded batchで削除します。

## Deployment order

rate-limitを有効にしたapplicationをdeployする前に、`202609070006_api_rate_limits.sql` migrationを適用してください。テーブルが存在しない状態では保護対象APIをfail-openにしません。
