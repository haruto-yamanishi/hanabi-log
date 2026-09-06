# Production safety

Hanabi LOGの本番環境ではDemo Modeを使用しません。

## Demo Mode

`DEMO_MODE=true` はローカル開発・テスト用途だけで使用します。

productionで `DEMO_MODE=true` が設定されている場合、アプリは起動時検証で失敗します。また、`isDemoMode` 自体もproductionでは常に `false` になるため、デモ用Admin認証へフォールバックしません。

Productionでは明示的に次を設定してください。

```text
DEMO_MODE=false
```

あわせて、`assertProductionEnv()` が要求する本番用環境変数をすべて設定します。

## デプロイ前確認

- `NODE_ENV=production`
- `DEMO_MODE=false`
- Slack / Supabase / Notion / Cron用の必須環境変数が設定済み
- secretやtokenをGit・ログ・公開artifactへ出していない
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

Previewでデモ表示が必要な場合も、production環境へ `DEMO_MODE=true` を持ち込まないでください。デモ環境はdevelopment/testとして明確に分離します。
