# Content Security Policy

Hanabi LOGはNext.js App Routerのnonce対応を利用し、ページリクエストごとに新しいnonceを生成してCSPを適用します。

## Policy

Productionでは概ね次の制約を適用します。

- scripts: `self` + request nonce + `strict-dynamic`
- `unsafe-eval`: productionでは禁止
- inline script attributes: 禁止
- styles: frameworkのnonce付きstyleを許可
- style attributes: 現行UI互換のため許可（scriptとは分離）
- images: self / blob / data / Supabase / Slack avatar / Gravatar
- browser connections: self / Supabase HTTPS + WebSocket
- workers: self / blob（Service Workerを含む）
- objects / frames: 禁止
- base URI: self
- form actions: self
- frame ancestors: none
- productionではHTTP resourceをupgrade

Slack / Notion APIへのserver-side通信はブラウザCSPの`connect-src`対象ではありません。Private Storageへのsigned upload/readはブラウザからSupabaseへ通信するため許可します。

## Nonce flow

1. `src/proxy.ts`がページrequestごとに暗号学的にランダムなnonceを生成
2. request headerへ`x-nonce`とCSPを追加
3. Next.jsがCSP内のnonceを読み、framework script/styleへnonceを付与
4. 同じCSPをresponse headerへ付与

API、Next.js static assets、image optimizer、Service Worker、offline fallbackはProxyのpage CSP処理対象から除外します。

## Report-Only rollout

新しいdirectiveや外部originを追加する場合は、いきなりproduction enforcementを緩めるのではなく段階的に確認します。

1. Previewまたはproductionで一時的に`CSP_REPORT_ONLY=true`
2. Chromium / WebKitで主要フローを確認
   - login
   - report list/detail
   - create/edit/publish
   - image signed upload/read
   - PWA install / Service Worker
   - admin
3. Browser console / response headersで違反を確認
4. 必要なoriginだけをpolicyへ追加
5. `CSP_REPORT_ONLY=false`へ戻してenforce
6. 同じ主要フローを再確認

Report-Onlyを常設の逃げ道として使わず、検証期間だけ利用します。

## Development

React / Next.js development debuggingのため、developmentだけ`unsafe-eval`を許可します。Production policyへは含めません。

## Adding a new browser integration

新しい外部サービスをbrowserから直接利用する場合、CSPを`*`へ広げないでください。

1. 必要なresource typeを特定する（connect/img/script等）
2. 最小originを追加する
3. Report-Onlyで検証する
4. testを更新する
5. enforcementへ移行する

Server-only integrationはCSP allowlistへ追加する必要がありません。
