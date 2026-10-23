# 過去のパッチノートの復元根拠

`src/lib/release-history.ts` と `/updates` に掲載する履歴の根拠です。日付はコミット日で、デプロイ日を保証するものではありません。重複したマージ・取り消された変更・開発用の一時コミットは独立した更新として掲載していません。

## 2026年10月17日 — 通知履歴とSlackの過去データ取り込みを改善

- 管理画面のDM履歴をまとめ、いいね通知や活動リマインドについて、送信した本文・宛先・結果を確認できるようにしました。
- Slackで削除済みなどの理由で取得できないスレッドがあっても、ほかの日報のスタンプ取り込みを続けられるようにしました。
- 過去のスタンプ取り込みと、日報ごとのいいね集計を効率化しました。Googleログインのプロフィール画像が表示されない問題も修正しました。

根拠: [3d197e5](https://github.com/haruto-yamanishi/hanabi-log/commit/3d197e5), [7293d7a](https://github.com/haruto-yamanishi/hanabi-log/commit/7293d7a), [6ae3971](https://github.com/haruto-yamanishi/hanabi-log/commit/6ae3971), [cd964c3](https://github.com/haruto-yamanishi/hanabi-log/commit/cd964c3), [dc4f064](https://github.com/haruto-yamanishi/hanabi-log/commit/dc4f064)

## 2026年10月15日 — コメントへの反応とメンターのログインに対応

- Slackの日報スレッド内のコメントについたスタンプも、日報のいいねに反映するようにしました。WebとSlackで同じ人が反応しても、日報へのいいねは重複して数えません。
- 登録済みのメンターが指定のGoogleアカウントでログインできるようにしました。利用できるアカウントは管理設定で制限しています。

根拠: [fb2f7d2](https://github.com/haruto-yamanishi/hanabi-log/commit/fb2f7d2), [a91be42](https://github.com/haruto-yamanishi/hanabi-log/commit/a91be42)

## 2026年10月1日 — 運用基盤の更新

- Slack・データ保存まわりのライブラリを更新しました。
- 依存ライブラリの更新、コード検査、バックアップ・復元確認の自動処理を整備しました。

根拠: [ed9cc2e](https://github.com/haruto-yamanishi/hanabi-log/commit/ed9cc2e), [b9c4d92](https://github.com/haruto-yamanishi/hanabi-log/commit/b9c4d92), [09bf4f1](https://github.com/haruto-yamanishi/hanabi-log/commit/09bf4f1), [d0956ab](https://github.com/haruto-yamanishi/hanabi-log/commit/d0956ab), [ccdec92](https://github.com/haruto-yamanishi/hanabi-log/commit/ccdec92), [f94c2fa](https://github.com/haruto-yamanishi/hanabi-log/commit/f94c2fa)

## 2026年9月19日 — 活動が空いたときのリマインド

- 日報やコメントなどの活動が14日間空いたメンバーへ、Slackでリマインドする処理を追加しました。

根拠: [6db992c](https://github.com/haruto-yamanishi/hanabi-log/commit/6db992c)

## 2026年9月8日 — バックアップとアップロードの安定性を改善

- 日報データと添付ファイルのバックアップ、復元できるかを確かめる自動処理を追加しました。
- 添付ファイルの検証結果を保存できず、アップロードが完了しない問題を修正しました。

根拠: [6f817f5](https://github.com/haruto-yamanishi/hanabi-log/commit/6f817f5), [406187c](https://github.com/haruto-yamanishi/hanabi-log/commit/406187c)

## 2026年9月7日 — Slackからの日報・スタンプ取り込みと動画添付

- Slackチャンネルに直接書いた投稿を日報として取り込み、投稿後の編集も同期できるようにしました。
- 過去のスタンプをいいねとして取り込み、複数のスタンプやWebのいいねを重複して数えないようにしました。いいねの節目のDM通知と履歴も追加しました。
- MP4・WebM動画の添付と、アップロード前の画像の軽量化に対応しました。
- 添付ファイルの内容検証、アクセスの集中への対策、管理操作の記録を追加しました。日付の判定を日本時間にそろえました。

根拠: [fc0fddf](https://github.com/haruto-yamanishi/hanabi-log/commit/fc0fddf), [b49af4c](https://github.com/haruto-yamanishi/hanabi-log/commit/b49af4c), [47cc2f7](https://github.com/haruto-yamanishi/hanabi-log/commit/47cc2f7), [6f8ada8](https://github.com/haruto-yamanishi/hanabi-log/commit/6f8ada8), [f9fe71c](https://github.com/haruto-yamanishi/hanabi-log/commit/f9fe71c), [feb2a88](https://github.com/haruto-yamanishi/hanabi-log/commit/feb2a88), [bd695d3](https://github.com/haruto-yamanishi/hanabi-log/commit/bd695d3), [80ffb5b](https://github.com/haruto-yamanishi/hanabi-log/commit/80ffb5b), [87a3abd](https://github.com/haruto-yamanishi/hanabi-log/commit/87a3abd), [8d2ba55](https://github.com/haruto-yamanishi/hanabi-log/commit/8d2ba55)

## 2026年9月6日 — ホーム画面への追加と日常操作の改善

- スマートフォンのホーム画面に追加して、アプリのように使えるようにしました。オフライン時の案内と再接続も整えました。
- 下書きの削除、公開後の同期状態の表示、日報一覧の読み込みを改善しました。
- 起動時のHanabiロゴのアニメーションを調整しました。

根拠: [df8f310](https://github.com/haruto-yamanishi/hanabi-log/commit/df8f310), [ac2c6ac](https://github.com/haruto-yamanishi/hanabi-log/commit/ac2c6ac), [27147da](https://github.com/haruto-yamanishi/hanabi-log/commit/27147da), [669f139](https://github.com/haruto-yamanishi/hanabi-log/commit/669f139)

## 2026年8月21日 — カレンダー・活動記録・ランキングを追加

- カレンダーから日付ごとの日報を探せるようにしました。
- メンバープロフィールと活動グラフ、チームのランキング、マイページのランキングタブを追加しました。
- 日報を保存したあとにSlack・Notionへの同期を進める形にし、外部連携の待ち時間を減らしました。活動集計が失敗してもコメントは表示できるようにしました。
- ログイン状態を48時間保持する設定と、Hanabiロゴの起動画面を追加しました。

根拠: [2c63cf6](https://github.com/haruto-yamanishi/hanabi-log/commit/2c63cf6), [621a63a](https://github.com/haruto-yamanishi/hanabi-log/commit/621a63a), [ea810c7](https://github.com/haruto-yamanishi/hanabi-log/commit/ea810c7), [ece67b1](https://github.com/haruto-yamanishi/hanabi-log/commit/ece67b1), [212ce88](https://github.com/haruto-yamanishi/hanabi-log/commit/212ce88), [bbfd5db](https://github.com/haruto-yamanishi/hanabi-log/commit/bbfd5db), [4280f1d](https://github.com/haruto-yamanishi/hanabi-log/commit/4280f1d), [1b492c2](https://github.com/haruto-yamanishi/hanabi-log/commit/1b492c2)

## 2026年8月20日 — Hanabi Logの基本機能を実装

- チーム限定のSlackログイン、日報の下書き・公開・編集・アーカイブ、検索、添付ファイルの保存を実装しました。
- 公開した日報をSlackとNotionへ同期し、Slackでは投稿者へメンションするようにしました。WebコメントとSlackの返信の連携も追加しました。
- 日報のいいね、週間ベスト、メンバー管理、Inactiveメンバーの日報の公開承認を追加しました。
- Hanabiのブランドに合わせた画面と、折りたためるサイドバーを整えました。

根拠: [f9f2a47](https://github.com/haruto-yamanishi/hanabi-log/commit/f9f2a47), [ce51c94](https://github.com/haruto-yamanishi/hanabi-log/commit/ce51c94), [b422c73](https://github.com/haruto-yamanishi/hanabi-log/commit/b422c73), [9eed4a5](https://github.com/haruto-yamanishi/hanabi-log/commit/9eed4a5), [ebd8e24](https://github.com/haruto-yamanishi/hanabi-log/commit/ebd8e24), [153c84e](https://github.com/haruto-yamanishi/hanabi-log/commit/153c84e), [8ea9c78](https://github.com/haruto-yamanishi/hanabi-log/commit/8ea9c78), [c6d3c1c](https://github.com/haruto-yamanishi/hanabi-log/commit/c6d3c1c), [92461ed](https://github.com/haruto-yamanishi/hanabi-log/commit/92461ed)
