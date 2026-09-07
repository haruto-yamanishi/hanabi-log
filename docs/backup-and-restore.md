# Backup and automated restore drills

Hanabi LOGは「backup jobが成功した」ことではなく、**DBとPrivate Storageを実際に隔離環境へ復元して整合性検証できたこと**を復旧可能性の基準にします。

## Objectives

初期SLOはDisaster Recovery Runbookと同じです。

- RPO: 24時間
- RTO: 4時間
- DB backup: 毎日
- Private Storage backup: 毎日、DBとは別ファイル/manifest
- Automated restore drill: 毎週実行し、最低でも月1回の成功を維持

RPO/RTOは実測restore時間とデータ量に応じて見直します。

## Backup boundary

正本は次の2系統です。

1. PostgreSQL application schemas
   - `public`
   - `supabase_migrations`
2. Supabase Private Storage bucket
   - object bytes
   - object path
   - byte size
   - SHA-256 manifest

Slack / Notionは配信先でありbackupの正本にはしません。

## Isolation

Backup destinationには**本番Supabase projectとは別のSupabase project**を使用します。バックアップ先bucketはprivateのままにし、公開URLを作りません。

GitHub Actions artifactへ本番dump、Private Storage bytes、manifestを保存しません。Workflow logにも本文、object path、token、dump内容を出しません。

## Required repository secrets

Repository AdminがGitHub Actions secretsへ設定します。

- `PRODUCTION_DATABASE_URL`
- `PRODUCTION_SUPABASE_URL`
- `PRODUCTION_SUPABASE_SECRET_KEY`
- `BACKUP_SUPABASE_URL`
- `BACKUP_SUPABASE_SECRET_KEY`
- `RESTORE_DRILL_SLACK_WEBHOOK_URL`（推奨。失敗通知用）

Repository variablesは任意です。

- `PRODUCTION_SUPABASE_STORAGE_BUCKET` default `hanabi-log-private`
- `BACKUP_SUPABASE_STORAGE_BUCKET` default `hanabi-log-backups`

秘密値をIssue、PR本文、docsへ貼り付けないでください。

## Daily backup workflow

`.github/workflows/backup.yml`は毎日03:20 JSTに実行します。

1. PostgreSQL 17 clientで`public` + `supabase_migrations`をcustom-format dump
2. Private Storageをserver credentialで列挙
3. 各objectをdownloadし、sizeとSHA-256をmanifestへ保存
4. Storage bytesをarchive化
5. DB dump / Storage archive / manifestを別Supabase projectのprivate bucketへupload
6. `latest.json` pointerを更新
7. runner上の一時データを削除

DBとStorageは別backup payloadなので、片方だけの破損もrestore drillで検出できます。

## Automated restore drill

`.github/workflows/restore-drill.yml`は毎週実行します。

1. Backup projectの`latest.json`を読む
2. DB dump / Storage archive / manifestを取得
3. GitHub Actions上のfresh PostgreSQL 17 serviceへDBをrestore
4. Storage archiveをrunnerの隔離directoryへ展開
5. `scripts/verify-restore.ts`で以下を検証
   - required tablesの存在
   - 最新migration version
   - report/member等の参照整合性
   - DB attachmentがStorage manifestに存在
   - attachment byte size一致
   - 全Storage objectのSHA-256一致
   - 主要table件数をaggregateだけで確認
6. production DBの`restore_drill_runs`へpassed/failedだけを記録
7. 失敗時はSlack webhookへActions run URLだけを通知
8. runner上のrestoreデータを削除

復元した本文やobject名を`restore_drill_runs`へ保存しません。

## Migration order

Application release前にrepositoryのmigrationをproductionへ適用します。Daily backupは`supabase_migrations.schema_migrations`もdumpし、restore drillはrepository内の最新migration prefixが復元DBに存在することを確認します。

つまりschema変更後にbackupが更新されなければrestore testが失敗し、古いbackupを「復旧可能」と誤認しません。

## First-time setup / acceptance

コードをmergeしただけではrestore保証は完了しません。Repository Adminは次を実施してください。

1. 本番とは別のbackup Supabase projectを作成
2. 上記secretsを登録
3. DB migrationを適用
4. `Backup` workflowを手動実行して成功させる
5. `Restore Drill` workflowを手動実行して成功させる
6. `restore_drill_runs`に`passed`が記録されることを確認
7. Slack failure notificationをテストする
8. その後scheduled workflowを継続監視する

初回restore drillが成功するまではIssue #35を完了扱いにしません。

## Manual recovery

実障害時の復旧判断、credential rotation、DNS、外部service切り分け、復旧後checklistは`docs/disaster-recovery.md`を参照してください。Automated drillはRunbookを置き換えるものではありません。
