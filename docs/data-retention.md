# Data Retention Policy

Hanabi LOGでは、長期的な知識記録と一時的な運用データを分離する。日報・将来のRevision・Audit Log等の正本/履歴データを、運用テーブルのcleanupと同じルールで削除してはいけない。

## Automated retention

| Data | Retention | Reason |
| --- | ---: | --- |
| `idempotency_keys` | 60 days | retry windowを十分に超えた重複防止response cache |
| delivered `outbox_jobs` | 90 days after completion | 配信調査期間を残しつつ成功jobの無限増加を防ぐ |
| dead `outbox_jobs` | 365 days | 長期障害調査・傾向分析のため成功jobより長く保持 |
| processed `slack_incoming_reports` | 180 days | Slack retry重複防止と調査期間 |
| processed `slack_report_reactions` | 180 days | reaction retry/tombstoneの調査期間 |

以下はこのcleanup対象外。

- members
- reports
- related links
- attachments
- report likes / contribution history（別途product policyが決まるまで）
- Audit Log
- Report Revision
- 未処理/処理中/再試行待ちのOutbox
- 未処理Slack event/reaction

## Execution

既存のintegration Cronの最後でcleanupを実行する。各categoryは1回最大500件を削除し、巨大な単発DELETEや長時間lockを避ける。蓄積が多い場合は複数回のCronで徐々に追いつく。

## Safety rules

- cleanupは冪等であること。
- `pending` / `processing` / retry対象データを削除しない。
- dead-letterのretentionを短くしない。
- retention期間を短縮する変更はPRで明示する。
- retention対象追加時は、障害解析・法務/プライバシー・データ可搬性への影響を確認する。
- 大規模削除前にはbackup/restore手順が利用可能であることを確認する。

## Audit and Revision

Audit LogとReport Revisionは長期履歴として扱い、この自動cleanupから除外する。将来容量上限が問題になった場合も、削除より先にcold archive / portable archiveへの退避を検討する。
