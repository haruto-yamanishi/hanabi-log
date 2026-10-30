# 2026 お土産Halloweenビンゴ

宣言日報: `17465aa9-6cfc-47b7-bb57-bc2942225e68`。
宣言公開時刻（2026-10-30 02:42:32.753 JST）より後、11/6 19:00 JSTより前に公開された日報が対象。日報の日付ではなく公開時刻を利用する。主催者本人は除外し、Inactive・権限による対象制限は設けない。下書きは対象外。獲得した参加権は投稿を後でアーカイブしても維持する。

`202610300001_halloween_bingo.sql` は既存投稿を取り込み、以後はDBトリガーでWeb公開・承認・Slack取り込みを登録する。メンバーごとの主キーで重複登録を防止。

`DEMO_MODE=false node --env-file=.env.local --conditions=react-server --import tsx scripts/setup-halloween-bingo.ts --apply` で10/30 19:00 JSTのSlack予約投稿を登録。配信先は既存の成功した週間日報配信先を確認する。実行前にmigrationを適用する。予約IDがある場合は再実行しない。`scheduling` が残ったらSlackの予約一覧で照合し、確認なく再予約しない。

Slackの予約投稿はmetadataを付けない（公式APIの既知の制限）。告知のbotイベント、公開後処理、Slack取り込み後処理からスレッドを確認して参加者をメンションする。既存integrations cronと毎日19:05 JSTの専用cronでも再試行する。Hobbyのcron実行には最大1時間の遅れがあり得るが、親告知はSlack自身が19:00に予約配信する。

通知はキャンペーン行ロックで直列化し、送信前に全スレッドをページングして既送信を照合する。Slack受理後にDB保存が失敗しても重複投稿しない。Slack読取に失敗した場合は送信しない。

認証済みAPI `/api/bingo` は参加者名と獲得日時だけを返す。🎃ボタンは11/8 00:00 JSTに非表示。`/?bingo=1` で参加者ウインドウを開く。

検証: 専用の空のローカルDBで `BINGO_TEST_DATABASE_URL=postgres://USER@127.0.0.1:PORT/EMPTY_DB npx vitest run src/server/integrations/halloween-bingo.test.ts`。UIは `npx playwright test e2e/halloween-bingo.spec.ts --project=desktop --project=mobile`。

Slack公式: https://docs.slack.dev/reference/methods/chat.scheduleMessage/
