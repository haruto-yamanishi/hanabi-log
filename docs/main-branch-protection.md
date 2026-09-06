# `main` branch protection

Hanabi LOGの`main`は、Repository Rulesetで直接変更を防ぎ、PRとCIを通した変更だけを受け入れる運用にします。

## Required ruleset

GitHub Repository Adminは **Settings → Rules → Rulesets → New ruleset → New branch ruleset** で次の設定を作成してください。

### Basic

- Name: `protect-main`
- Enforcement status: `Active`
- Target branches: `Include default branch`（`main`）
- Bypass list: 原則なし
  - 緊急時に追加する場合もRepository Owner/Adminだけに限定し、通常運用では利用しない

### Branch rules

次を有効にします。

- Restrict deletions
- Block force pushes
- Require a pull request before merging
  - Required approvals: `1`
  - Dismiss stale pull request approvals when new commits are pushed: ON
  - Require review from Code Owners: OFF（CODEOWNERS導入後に再検討）
  - Require approval of the most recent reviewable push: ON
  - Require conversation resolution before merging: ON
- Require status checks to pass
  - Require branches to be up to date before merging: ON
  - Required check: `verify`
- Require linear history: OFF
  - squash / rebase / merge commitの選択肢を現在は維持する

## Why `verify`

`.github/workflows/ci.yml`の主要CI jobは`verify`です。lint、typecheck、unit test、build、E2Eを通過した変更だけをmerge可能にします。

CodeQL / Dependency Reviewを有効化した後は、安定して実行されるcheck名を確認し、必要に応じてrequired status checkへ追加します。

## Dependency graph

Dependency Reviewを利用するには、Repository Adminが **Settings → Security → Advanced Security / Security analysis** でDependency graphを有効にする必要があります。

有効化後、PRのDependency Review workflowが成功することを確認してください。

## Emergency procedure

main保護を一時的に解除して直接pushする運用は行いません。緊急修正でも次の最短経路を使います。

1. `main`からhotfix branchを作成
2. 最小変更をcommit
3. PRを作成
4. required CIを通す
5. review conversationを解決
6. merge

GitHub障害等でRuleset自体が原因となる非常事態では、Repository Ownerが一時的なbypassを明示的に付与し、復旧後すぐに削除します。実施内容はIssueまたはincident記録へ残します。

## Verification checklist

設定後にテスト用branchで以下を確認します。

- [ ] `main`への通常pushが拒否される
- [ ] PRなしで`main`を変更できない
- [ ] CI失敗中のPRをmergeできない
- [ ] unresolved conversationがあるPRをmergeできない
- [ ] force pushが拒否される
- [ ] `main`削除が拒否される
- [ ] CI成功・approval・conversation解決後はmergeできる

## Permissions

この設定変更にはRepository Admin権限が必要です。write権限のContributorはRulesetを文書化・検証できますが、有効化そのものはRepository Adminが行います。
