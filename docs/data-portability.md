# Hanabi LOG 10 / 50 / 100-year Data Portability Specification

## Purpose

Hanabi LOGの記録を、現在利用しているSlack、Notion、Supabase、Vercel、GitHubなどの特定vendorから独立して保存・移行できるようにする。

この仕様では**Hanabi LOGのPostgreSQLとPrivate Object Storageを正本**とする。SlackとNotionは配信・閲覧用の派生先であり、完全復旧に必須な正本にはしない。

## Portability principles

1. Stable IDを再採番しない。
2. InstantはUTC ISO 8601で保存する。
3. 人間上の日付境界にはIANA timezone名（現在は`Asia/Tokyo`）を記録する。
4. Schema versionをarchiveに必ず含める。
5. 添付ファイルはDB dumpとは別に実体を保存し、manifestで対応付ける。
6. 秘密情報・credential・OAuth token・signed URLをexportしない。
7. 特定vendor SDKがなくてもarchiveを解析できる形式を使う。
8. Exportはread-only処理とし、本番データを変更しない。

## Canonical archive layout

```text
hanabi-log-export-YYYYMMDDTHHMMSSZ/
├ manifest.json
├ schema/
│  ├ schema-version.txt
│  └ migrations/
├ data/
│  ├ members.jsonl
│  ├ reports.jsonl
│  ├ related-links.jsonl
│  ├ attachments.jsonl
│  ├ integration-bindings.jsonl
│  ├ report-likes.jsonl
│  ├ contribution-events.jsonl
│  ├ report-revisions.jsonl       # 存在する場合
│  └ audit-events.jsonl           # 存在する場合
├ attachments/
│  └ <stable-storage-path or content-id>
├ checksums/
│  └ SHA256SUMS
└ README.txt
```

大規模化した場合はJSONLを年/月単位でpartitionしてよい。CSVは人間確認用の副形式として生成してよいが、配列・JSON・nullable値を忠実に保存できるJSONLをcanonical machine-readable formatとする。

## `manifest.json`

最低限以下を含む。

```json
{
  "format": "hanabi-log-portable-archive",
  "formatVersion": 1,
  "exportedAt": "2026-09-07T00:00:00.000Z",
  "application": "Hanabi LOG",
  "applicationVersion": "<git commit sha or release>",
  "schemaVersion": "<latest migration identifier>",
  "timeZone": "Asia/Tokyo",
  "hashAlgorithm": "SHA-256",
  "recordCounts": {},
  "attachments": {
    "count": 0,
    "bytes": 0
  }
}
```

実際のarchiveへsecret、database URL、provider tokenを含めない。

## Stable identifiers

以下はexport/importを跨いで保持する。

- member UUID
- report UUID
- attachment/report relation
- contribution event key
- revision ID/version
- audit event ID
- external provider message/page IDは補助metadataとして保持してよい

別実装へimportする際も、衝突がない限りstable IDを維持する。vendor側IDをHanabi内部IDへ置き換えない。

## Timestamps and dates

- `created_at`, `updated_at`, `published_at`等のinstantはUTC ISO 8601へ正規化する。
- `report_date`のようなcalendar dateは`YYYY-MM-DD`を維持する。
- archive manifestへ`timeZone: Asia/Tokyo`を含め、将来timezone ruleが変わっても当時の意味を解釈できるようにする。
- Unix timestampだけを唯一のportable表現にしない。

## Reports

日報は少なくとも以下をlosslessにexportできること。

- ID / author ID
- report date
- title / summary
- activity area / content category / tags
- activity / learning / issue / next action
- status / version
- publish/archive/create/update timestamps
- approval状態が存在する場合はそのmetadata

現在のUI表示用に生成されたHTMLは正本としない。

## Members

内部参照の維持に必要なmember IDと表示名、role/status等をexportする。メールや外部user IDなど個人データは、運用上必要かつ適切な場合のみportable archiveへ含める。公開archiveへ変換する場合は別途匿名化工程を設ける。

## Attachments

Database backupだけではStorage object本体を復元できないため、必ず実ファイルをarchiveへ含める。

attachment manifestには最低限以下を保持する。

- attachment IDまたはstable relation
- report ID
- relative archive path
- original filename
- MIME type
- byte size
- SHA-256 digest

export時にはDBの全attachment pathとStorage objectを照合し、missing/orphanを結果へ記録する。signed URLは保存しない。

## Revisions and audit

`report_revisions` / `audit_events`導入後はportable archiveへ含める。

- Revisionは本文の歴史的状態を復元できること。
- Auditはactor/action/target/time/metadataを保持する。
- Audit内にtoken、secret、private credential本文を含めない。
- これらのテーブルが未導入の古いarchiveでは、manifestに`notAvailable`として明示してよい。

## Integration metadata

Slack/Notion情報は補助情報としてexportしてよい。

例:

- Slack channel ID / message timestamp / permalink
- Notion page ID
- delivery status

ただしimport先にSlack/Notionが存在しなくても、日報・添付・履歴そのものを完全に復元できなければならない。

## Schema and migrations

archiveには次を含める。

- 最新schema version / migration ID
- 復元に必要なmigration filesまたはそれらを特定できるrelease artifact
- application commit/release identifier

100年保存を想定し、migration名だけでなくportable format versionを別に管理する。アプリDB schemaの変更とarchive formatの変更を同じversion番号にしない。

## Integrity

export完了時に全portable data fileとattachmentについてSHA-256を計算し、`checksums/SHA256SUMS`へ保存する。

restore/import前にはhashを検証する。hash不一致のarchiveを自動的に正常扱いしない。

可能ならarchive全体を別管理鍵で署名する方式を将来追加する。署名鍵はarchive内へ同梱しない。

## Import contract

将来の別実装は最低限、以下を満たせばHanabi LOG archive importerとみなせる。

1. `manifest.json`のformat/versionを認識する。
2. checksumsを検証する。
3. members/reportsのstable IDを維持する。
4. relationsを壊さずimportする。
5. attachment実体を復元する。
6. unknown optional fieldsを理由に全importを失敗させない。
7. unknown future major format versionは黙って解釈せず停止する。
8. import結果として件数、skipped、warning、integrity errorを報告する。

## Validation after import

- member/report件数
- FK/reference integrity
- report revision chain
- audit event件数
- attachment count/bytes/hash
- sample report本文
- newest/oldest timestamps
- private/public access policy

を検証する。

## Secrets explicitly excluded

以下はportable data archiveへ含めない。

- `AUTH_SECRET`
- Database credentials / `DATABASE_URL`
- Supabase Secret Key
- Slack Client Secret / Bot Token / Signing Secret
- Notion OAuth Client Secret
- Notion access / refresh token
- token encryption key
- `CRON_SECRET`
- session token/cookie
- temporary signed URL

秘密情報のbackup/escrowはデータarchiveとは別のsecurity processで扱う。

## Storage copies

最低でも次の性質を持つcopyを維持することを推奨する。

- production providerとは障害ドメインが異なる場所
- 暗号化されたPrivate storage
- 世代管理
- 定期integrity verification
- restore drillで実際に読めることを確認

単一cloud account内のsnapshotだけを100年保存戦略としない。

## Review cadence

### Every year

- exportが成功するか
- checksum verification
- sample import/restore
- format readerが現行runtimeで動くか
- storage media/provider risk

### Every 10 years

- archive formatの可読性
- hash/signature algorithmの陳腐化
- file formatの陳腐化
- provider dependency
- migration toolingの再評価

### 50-year review

現行実装言語・database・object storageに依存せず、第三者が仕様書とarchiveだけでimporterを再実装可能か確認する。

### 100-year objective

当時のSlack/Notion/Supabase/Vercel/GitHubが存在しなくても、日報本文、メンバーとの関係、添付、revision、audit、timestamp、integrity情報を再構成できることを目標とする。

## Ownership

この仕様はarchitectureやprovider変更と同時に更新する。新しい正本データを追加した場合は、機能を本番導入する前に「どうexport/importするか」を定義する。
