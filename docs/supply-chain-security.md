# CI / Supply Chain Security

Hanabi LOGのCI/CDでは、依存先の変更がそのまま実行コードになることを前提に、GitHub Actionsとnpm依存関係を継続監視します。

## GitHub Actions

- Workflow内のthird-party / GitHub公式Actionは、可変tagだけではなくfull commit SHAへpinする。
- SHA末尾のコメントに確認時のrelease/tagを残す。
- Actionを更新する際は、公式repositoryのrelease/tagが指すcommitを確認してからSHAを更新する。
- Workflow tokenはjobに必要な最小permissionsだけを付与する。
- checkoutではCIからpushする必要がない限り`persist-credentials: false`を使う。

## Automated checks

- `CI`: lint / typecheck / unit tests / build / E2E。
- `CodeQL`: JavaScript/TypeScriptをPR、main push、週次で解析する。
- `Dependency Review`: PRで新しく導入されるHigh以上の既知脆弱性をblockする。
- `Dependabot`: npmとGitHub Actionsを週次で更新候補として提出する。

## Dependency Review activation

Dependency ReviewはGitHubのDependency graphが有効であることを前提とします。Dependency graphが無効な状態でActionを実行すると、脆弱性の有無ではなくrepository設定不足でPRが失敗します。

そのため、workflowはrepository variable `DEPENDENCY_REVIEW_ENABLED=true` のときだけ実行します。Repository Adminは次の順序で有効化します。

1. GitHub repository settingsでDependency graphを有効化する。
2. Repository variable `DEPENDENCY_REVIEW_ENABLED=true`を設定する。
3. テストPRを作り、`Dependency Review` jobがskipではなく実行されて成功することを確認する。
4. main ruleset / branch protectionのrequired checkへDependency Reviewを追加する。

有効化前はCodeQL・CI・Dependabot・SHA pinは有効ですが、Dependency Reviewは強制されていないため、Issue #37を完了扱いにしません。

## Dependency updates

自動更新PRであっても、CIが成功する前にmergeしない。Major updateはrelease notes、breaking changes、migration要否を確認する。認証、DB、Slack/Notion、Storage、Next.js関連依存は特に手動レビューする。

## Pin rotation

SHA pinは固定したまま放置しない。Dependabotまたは定期レビューで新しいreleaseを確認し、更新PRを通常のCIに通す。未知のforkや保守停止Actionへ置き換えない。

## Secrets

CI fixtureには実token、メール、日報本文、signed URL、本番DB接続情報を入れない。GitHub Actions logやartifactへ秘密値を出力しない。
