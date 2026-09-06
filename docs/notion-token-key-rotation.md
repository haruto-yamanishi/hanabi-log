# Notion OAuth token encryption key rotation

Hanabi LOGはNotion OAuth tokenをAES-256-GCMで暗号化して保存する。新規ciphertextは`v2.<key-id>.<iv>.<tag>.<ciphertext>`形式を使用し、key idから復号鍵を選択する。

旧`v1` ciphertextにはkey idがないため、rotation中はcurrent keyと`NOTION_TOKEN_DECRYPTION_KEYS`の全候補を順に試す。復号に成功した旧ciphertextは、通常のNotion connection読み込み時にcurrent keyへbest-effortで再暗号化される。

## Variables

- `NOTION_TOKEN_ENCRYPTION_KEY`: current 32-byte base64 key
- `NOTION_TOKEN_ENCRYPTION_KEY_ID`: current keyのstable ID。`.`を含めず英数字、`_`、`-`を使用する
- `NOTION_TOKEN_DECRYPTION_KEYS`: 旧decrypt-only keyを`key-id:base64,key-id-2:base64`形式で指定

## Rotation procedure

例: `2026-01`から`2027-01`へ変更する。

1. 新しい32-byte random keyを生成し、secret managerへ保存する。値をIssue/PR/Slackへ貼らない。
2. **旧keyをまだ削除しない。**
3. Production envを次の状態にする。
   - `NOTION_TOKEN_ENCRYPTION_KEY_ID=2027-01`
   - `NOTION_TOKEN_ENCRYPTION_KEY=<new key>`
   - `NOTION_TOKEN_DECRYPTION_KEYS=2026-01:<old key>`
4. deployする。
5. AdminでNotion connectionを読み込み、通常同期を実行する。
6. DB上のciphertext prefixが`v2.2027-01.`へ移行したことを、token本文を表示せず確認する。
7. 複数deployment/workerが旧設定で動いていないことを確認する。
8. 十分なrollback window後、旧keyを`NOTION_TOKEN_DECRYPTION_KEYS`から削除する。

## Legacy v1 migration

既存`v1` tokenを持つ状態でcurrent keyを先に捨てると復号不能になる。初回rotationでは、旧`NOTION_TOKEN_ENCRYPTION_KEY`を必ずdecrypt-only keyとして残してから新keyへ切り替える。

v1はkey idを持たないため、複数の旧keyを設定している場合は全候補を試す。v2移行後はkey idによる直接選択になる。

## Rollback

新key deploymentに問題がある場合でも、旧keyをdecrypt-only setから削除していなければ旧ciphertextを読める。rollback時は新keyもdecrypt-only setに残し、新deploymentが作成したv2 ciphertextを旧appが読めない状況を避けること。

**注意:** v2非対応の古すぎるapplication buildへrollbackすると新ciphertextを読めない。deployment rollbackの前にciphertext format互換性を確認する。

## Verification

- 新しいOAuth connectionがcurrent key idのv2で保存される
- 旧v2 tokenをprevious keyで復号できる
- legacy v1 tokenをprevious keyで復号できる
- context/AADが異なるtokenは復号できない
- unknown v2 key idはfail-closedする
- keyやtoken本文をapplication logへ出さない
