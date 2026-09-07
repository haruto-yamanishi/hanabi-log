# Branch Cleanup Runbook

この文書は、完了済みPRの作業ブランチと関連Issueを安全に整理するための運用手順です。

## 原則

削除前に、必ず最新のGitHub状態を再確認します。過去のメモやローカル状態だけを根拠に削除しません。

ブランチを削除してよいのは、次のいずれかを満たす場合のみです。

1. 対応PRが `merged`
2. 古いPRが正式にreplacement PRへ置き換えられ、旧PRが `closed`
3. 必要な変更がすでに `main` へ取り込まれていることを確認できる

以下は削除禁止です。

- Open PRのhead branch
- 未PRの作業ブランチ
- `main` に未反映の変更が残っているブランチ
- 状態が不明なブランチ
- 他PRのbase/headとして使用中のブランチ

## 削除前の確認

```bash
git fetch --all --prune
git branch -r
```

必要なら差分も確認します。

```bash
git log --oneline origin/main..origin/<branch>
```

ただしSquash MergeされたPRでは、元ブランチのcommit SHA自体が `main` に存在しない場合があります。そのため、`git log` にcommitが表示されるだけで「未merge」と判断してはいけません。GitHub上のPRの `merged` / `merged_at` 状態を優先します。

## 2026-09-07時点で削除候補だったブランチ

以下は当時の確認では削除可能でした。実際に削除する時点で再確認してください。

```text
chore/codeql-action-v4
db/operational-retention
docs/disaster-recovery-runbook
docs/long-term-portability
docs/main-branch-ruleset
feature/image-auto-compression
fix/slack-incoming-dead-letter
fix/slack-incoming-dead-letter-v2
refactor/asia-tokyo-timezone
security/api-rate-limit
security/append-only-audit-log
security/ci-supply-chain
security/notion-key-rotation
security/production-demo-fail-closed
security/strict-csp
```

## 必ず残すもの

### `main`

削除禁止です。

### `ops/automated-restore-drill`

Issue #35関連のBackup / Restore実装ブランチです。2026-09-07時点ではPR未作成かつ `main` 未反映の独自コミットが残っていたため、削除禁止です。

後で最新版 `main` へ追従させ、レビュー・CIを通してPR化します。

### Open Dependabot PRのブランチ

PRがOpenの間は削除しません。2026-09-07時点では次が該当していました。

```text
dependabot/npm_and_yarn/supabase/supabase-js-2.115.0
dependabot/npm_and_yarn/types/react-dom-19.2.7
dependabot/github_actions/actions/dependency-review-action-5.0.0
```

対応PRは当時 #63 / #64 / #66 でした。PRがmergeまたは意図的にcloseされた後に再判定します。

## Slack旧ブランチの扱い

旧PR #30のブランチ:

```text
fix/slack-incoming-dead-letter
```

は、古い `main` とmigration番号衝突があったため、そのままmergeせずreplacementとしてPR #68を作成しました。

replacement側:

```text
fix/slack-incoming-dead-letter-v2
```

PR #68のmergeを確認した後で、旧・新の両ブランチを削除して構いません。

## Remote branch削除

```bash
git push origin --delete <branch>
```

例:

```bash
git push origin --delete feature/image-auto-compression
```

削除後:

```bash
git fetch --prune
```

## Local branch整理

merge済みと確認できる場合:

```bash
git branch -d <branch>
```

`-D` は原則使用しません。

```bash
git branch -D <branch>
```

が必要な場合は、削除前に未merge commitが本当に不要か再確認します。

## Issue Cleanup

Issueは、単にコードがmergeされたからCloseするのではなく、acceptance criteriaと運用上の残作業まで完了してからCloseします。

### #34 API Rate Limit

コードmerge後も、production migrationと `RATE_LIMIT_MODE=enforce` の有効化、429 / `Retry-After` の確認が残っている場合はOpen維持します。

### #37 Supply Chain Security

次が完了するまでOpen維持します。

- Dependency graph有効化
- `DEPENDENCY_REVIEW_ENABLED=true`
- 実PRでDependency Review成功確認

### #32 Main Branch Ruleset

ドキュメントmergeだけでは完了ではありません。Repository Rulesetの実適用と動作確認が終わるまでOpen維持します。

### #35 Backup / Restore

次まで完了してからCloseします。

- `ops/automated-restore-drill` のPR化
- CI成功
- merge
- 必要なGitHub Secrets設定
- 実Backup成功
- 実Restore Drill成功

## 最終確認

作業後は次を報告します。

- 削除したbranch一覧
- 残したbranch一覧
- 削除を見送ったbranchと理由
- CloseしたIssue
- Open維持したIssueと残作業
- 現在OpenなPR一覧
- `main` の最新SHA

推測で「削除済み」「Close済み」と記録せず、GitHubの実結果を確認して報告します。
