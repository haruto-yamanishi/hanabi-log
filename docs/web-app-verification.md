# Web App・下書き削除・一覧通信の確認（2026-09-06）

## 実装

- #19: 下書き本人とAdminに削除ボタンを表示。詳細・編集の両画面で確認ダイアログを出す。DBは行ロック後に権限とversionを再確認し、同時公開・編集された下書きの削除を拒否する。削除後はマイページに戻り、GET/PATCHでも再利用できない。
- #13: 日報カードの `prefetch={false}` は既存実装を維持。通常一覧では本文・添付・関連リンク・いいねした人・外部同期情報を返さない。外部同期用JOINはAdminが `includeIntegration=true` を指定した場合だけ実行する。
- #14: 既存の `after()` / Outboxの遅延実行を維持。公開・更新レスポンスが処理開始・終了に依存しないテストと、失敗しても公開状態が返るテストを追加。詳細画面の同期待ちは5秒ごと、表示中に最大12回更新する。既存の再試行・旧versionのsuperseded処理を継続する。
- #16: SafariとNodeのIntlの日付区切り差によるhydrationエラーを修正。詳細のいいね更新にもkeepaliveを設定し、ページ移動時の中断を防止。同じNext.jsアプリにmanifest、192/512pxアイコン、180px Appleアイコンを追加。ロゴはmaskableの安全領域内に収める。起動アニメーション・内部ナビゲーション・既存OAuthの遷移を使用する。
- #17: 主要コンテンツ表示後1.5秒以上待って案内する。投稿・編集・管理画面、入力フォーカス中、standalone、インストール済み、非対応環境では表示しない。「あとで」は7日間控える。Chrome系は保持したイベントの `prompt()` を使用し、SafariはmacOS Sonoma以降の「ファイル → Dockに追加」を案内する。

## オフラインとデータ

Service Workerが保存するのは公開の `/offline.html` だけ。認証済みページ・日報・API・OAuthレスポンスをCache Storageに保存しない。通常の文書ナビゲーションが失敗、8秒を超過、またはHTTP 5xxの場合は専用画面のネイティブリンクから再読み込みできる。再試行はJavaScriptの読み込みに依存しない。APIやOAuthのURLはWorkerの処理対象外。表示中に接続が切れた場合は入力を保持して通知する。

下書きはDBで削除が確定してから添付を除去する。これにより同時公開された日報の画像を消さない。ストレージ側の除去失敗はサーバーログ `Deleted draft attachment cleanup failed` に記録する。日報は削除済みで、失敗した添付オブジェクトの後処理は必要になる。

## 性能測定

本番ビルドを `DEMO_MODE=true npm run start -- --port 3008` で起動し、`node scripts/performance-check.mjs` を実行。外部サービスに接続しないデモ3件、Chromium、1440px幅、無スロットリング。

| 項目 | 結果 |
| --- | --- |
| 表示カード | 3件 |
| 日報詳細の自動RSC取得 | 0件 |
| ホームの総通信数（5秒待機） | 77件 |
| DOMContentLoaded | 229ms |
| load | 480ms |
| 同期情報を含む一覧 | 2,767 bytes |
| 通常一覧 | 2,029 bytes（26.7%減） |
| 一覧API 10回 | 1.6〜5.4ms |

サイズ比較は同じデータを、今回のAdmin用同期情報付きレスポンスと通常一覧で比較したもの。issue報告の127件と今回の77件はデータ・環境が異なるため直接の速度改善率にはしない。DB実機の応答時間はこのデモ計測には含まない。Chrome DevTools MCPは利用できず、PlaywrightのrequestイベントとNavigation Timingを使用した。

## 検証範囲

- lint、TypeScript、ユニット/API/リポジトリテスト121件、本番ビルドが成功。
- ChromiumのPC・390pxとWebKitで下書きの削除キャンセル／確定、再アクセス不可、案内遅延・dismiss保存・正式prompt呼び出し・standalone抑制、アイコンPNGサイズ、オフライン画面と復帰を自動確認。WebKitは `setOffline` がSWより前にナビゲーションを中断するため、実際のソケット切断で公開SWとオフライン画面の復帰を独立確認した。
- PostgreSQLはタグ付きSQLのテストで、通常一覧のJOIN省略と、削除時のロック後の権限・version確認を検証。実DBへの削除テストは行っていない。
- インストールイベントはブラウザテスト内で模擬。OSのDock操作、実際のSlackアカウントでのOAuth完了・Notionへの実配信は自動テストの対象外。

## 実機での追加確認手順

1. macOS Sonoma以降のSafariで本番サイトを開き、ファイル → Dockに追加。Dockから再起動してSlackでログインし、再起動後にもセッションが維持されることを確認。
2. Chromeで本番サイトをアプリとして追加し、同様にログイン・再起動する。
3. ホーム、日報保存・編集、検索、カレンダー、マイページ、管理画面、画像アップロードを操作。外部Notion/Slackリンクが別ウィンドウ等で開くことを確認。
4. ネットワークを切って再起動し、接続エラー画面を確認。復旧後に再読み込みして元のURLへ戻る。

参考: [Next.js PWAガイド](https://nextjs.org/docs/app/guides/progressive-web-apps)、[MDN beforeinstallprompt](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event)、[Apple Safari Web App](https://support.apple.com/en-ca/104996)。
