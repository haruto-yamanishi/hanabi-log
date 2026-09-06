# Hanabi LOG Disaster Recovery Runbook

このRunbookは、担当者が交代しても重大障害からHanabi LOGを復旧できることを目的とする。秘密値そのものはこの文書へ記載しない。

## Recovery objectives

- **RPO (Recovery Point Objective): 24時間以内**
- **RTO (Recovery Time Objective): 4時間以内**
- DatabaseとPrivate Storageは別々にバックアップし、同じ復旧時点へ戻せるよう世代を対応付ける。
- 少なくとも月1回restore test、年1回以上の総合復旧訓練を行う。

## Roles

障害時は個人名ではなく役割で責任を引き継ぐ。

- **Incident Lead:** 優先順位、復旧判断、外部連絡を統括
- **Application Owner:** Vercel / Next.js / deploymentを担当
- **Data Owner:** PostgreSQL / Storage / backup / integrityを担当
- **Integration Owner:** Slack / Notion / OAuthを担当
- **Security Owner:** secret失効、認証・監査、侵害疑いの判断を担当

小規模運用では同一人物が複数roleを兼務してよいが、実施内容と時刻を記録する。

## Severity

### SEV-1

- DatabaseまたはStorageの消失・広範な破損
- 認証突破や秘密情報漏えいの疑い
- 誤操作で大量データが削除された
- Hanabi LOGが長時間全面停止し、通常復旧できない

対応: 書き込み停止を優先し、Incident Leadを立てる。必要なら外部連携も停止する。

### SEV-2

- Slack / Notion同期の広範な失敗
- 一部APIや主要画面が使用不能
- Outbox / Cronが長時間停滞

対応: 正本データへの書き込み可否を確認し、外部連携障害ならHanabi LOG本体を優先して継続する。

### SEV-3

- 単一ユーザー・単一日報・限定機能の不具合

通常Issue/PRフローで対応する。

## First 15 minutes

1. 障害開始時刻と最初の症状を記録する。
2. 追加破損の可能性がある場合はdeployまたは該当write pathを止める。
3. Vercel、Supabase、Slack、Notionの公式statusを確認する。
4. 最新deployment SHA、最新migration、直近の設定変更を確認する。
5. DBとStorageの最新backup時刻を確認する。
6. 秘密情報漏えい疑いの場合は、ログへ秘密値を書き出さずSecurity Ownerへ切り替える。

## Database recovery

1. 破損・誤削除が継続していないことを確認する。
2. 現DBを可能ならread-only相当へし、復旧前スナップショットを確保する。
3. 復旧対象時点を決定する。Storage backupと対応する時点を選ぶ。
4. まず隔離された新規DBへrestoreする。本番へ直接上書きしない。
5. migration履歴を確認し、アプリが期待するschema versionへforward migrationする。
6. 以下を検証する。
   - members / reports主要件数
   - FK・unique constraint
   - report -> attachment参照
   - integration bindings / outboxの整合性
   - 最新の日報を複数サンプル確認
7. 検証後に接続先を復旧DBへ切り替える。

原則として適用済みmigrationを手作業で逆変換しない。不可逆migrationは**backup restore + forward-fix**を基本とする。

## Storage recovery

1. `hanabi-log-private`の復旧対象世代をDBと対応付ける。
2. 別bucket/隔離領域へ復元する。
3. DB `attachments.storage_path`とobject一覧を比較する。
4. missing objectとorphan objectを集計する。
5. Private設定・MIME/size policyを確認する。
6. signed URLで少数サンプルを読み出し、実体を確認する。
7. 整合性確認後に本番bucketへ切り替える、または安全にコピーする。

## Secret or credential compromise

漏えいが疑われるsecretは「漏えいしていないか調べてから」ではなく、影響を評価しながら原則rotationする。

対象候補:

- `AUTH_SECRET`
- Slack Client Secret / Bot Token / Signing Secret
- `DATABASE_URL` credentials
- Supabase Secret Key
- Notion OAuth Client Secret
- Notion token encryption keys
- `CRON_SECRET`
- deployment / DNS管理アカウント

手順:

1. 影響するwrite pathを必要に応じて停止する。
2. provider側で旧credentialを失効またはrotationする。
3. secret manager/Vercel環境変数を更新する。
4. 再deployする。
5. 認証、Cron、Slack、Notion、Storageのsmoke testを行う。
6. Audit Logが利用可能なら該当時間帯を確認する。

秘密値はIssue、PR、Slack、Runbook、CI artifactへ貼らない。

## Slack outage / reconnect

Hanabi LOGのPostgreSQLを正本として扱う。Slack障害時に日報本体を巻き戻さない。

- Outboxを保持して再試行する。
- Bot token失効時はtokenを再発行・設定してからqueueを再処理する。
- Event Subscriptions変更時はSigning Secret、Request URL、scope、Bot参加チャンネルを確認する。
- 重複送信はidempotency/dedupe keyで抑止する。

## Notion outage / reconnect

Notionも正本ではない。

- Hanabi LOG本体の公開・編集を優先する。
- Outboxを保持する。
- OAuth connectionが無効ならAdminから再接続する。
- 再接続後に未配信/failed jobを再処理し、Report UUIDで重複page作成を防ぐ。

## Vercel outage

1. provider statusと直近deploymentを確認する。
2. 直近変更が原因なら既知の正常deploymentへrollbackできるか判断する。
3. DB migrationとの互換性を確認してから古いappを戻す。新schemaと非互換な古いbuildへ安易に戻さない。
4. 長期停止時はportability specificationに従い別hostingへ移行できる状態を維持する。

## Supabase outage

- DatabaseとStorageのどちらが影響しているか分離する。
- DB接続不能時は無理なwrite retry stormを避ける。
- Storageのみ障害なら日報本文の正本を保護し、添付処理を失敗として明示する。
- provider復旧不能時はbackupから別PostgreSQL/Object Storageへ復元する。

## Domain / DNS recovery

- domain registrar、DNS provider、Vercel projectの所有権を定期確認する。
- registrar accountにはMFAを必須とし、回復手段を組織で引き継ぐ。
- `APP_BASE_URL`、Slack redirect URL、Notion redirect URIを新domainへ更新する。
- TLS、redirect、OAuth callbackを検証する。

## Post-recovery integrity checklist

- [ ] ログインできる
- [ ] Member/Admin権限が正しい
- [ ] 日報一覧・詳細・検索が読める
- [ ] 新規draftを保存できる
- [ ] publishできる
- [ ] Private attachmentを読み書きできる
- [ ] Slack同期が成功する
- [ ] Notion同期が成功する
- [ ] Cronが実行できる
- [ ] pending/failed/dead queueが異常増加していない
- [ ] 最新backupが再開している

## Postmortem

SEV-1/2では復旧後に以下を残す。

- 発生時刻 / 検知時刻 / 復旧時刻
- user impact
- root cause
- contributing factors
- 復旧で有効だった手順 / 足りなかった手順
- 再発防止Issue
- Runbookの修正点

個人を責める記録ではなく、システム・手順を改善する記録にする。

## Drill schedule

- 月1回: Database + Storage restore test結果を確認
- 四半期: secret inventory、domain/DNS ownership、管理者権限を確認
- 年1回以上: 本Runbookを使った総合復旧訓練
- 大きなarchitecture/provider変更後: その都度Runbookと復旧テストを更新
