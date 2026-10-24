import type { Metadata } from "next";
import { releaseHistory } from "@/lib/release-history";
import { PageHeader } from "@/components/ui";
export const metadata: Metadata = { title: "パッチノート・クレジット" };
export default function UpdatesPage() {
  return <div className="page updates-page">
    <PageHeader title="パッチノート・クレジット" description="Hanabi Logの更新情報と、この場所をつくる人たち。" />
    <section className="admin-panel" aria-labelledby="publication-release"><p className="release-date">2026年10月24日 · メディア一覧・掲載許可</p><h2 id="publication-release">活動の記録を見つけ、本人の許可を得て発信する</h2><ul>
      <li>日報とコメントの写真・動画をまとめた「メディア」ページを追加。種類や添付先で絞り込み、日報本文と投稿者のプロフィールへ移動できます。</li>
      <li>ブランディング担当向けにMedia権限を追加。Adminも同じ掲載依頼の操作ができます。</li>
      <li>X・Instagram・note・IGNITERS・その他への掲載許可を、日報の詳細ページから依頼できます。依頼と返事をSlack DMで通知します。</li>
      <li>日報を書いた人は、原文のまま許可・自分で校正・校正を依頼・拒否から返事を選べます。校正がある場合は投稿本文と確認用URLを送り、本人が最終確認できます。</li>
      <li>依頼時の日報、校正内容、返事と確認履歴を保存し、元の日報を変更せずに掲載準備を進められます。</li>
    </ul></section>
    <section className="admin-panel" aria-labelledby="latest-release"><p className="release-date">2026年10月23日 · 操作性・管理機能の改善</p><h2 id="latest-release">書く・探す・見守るを、もっと使いやすく</h2>
      <ul>
        <li>本文で「@」を入力するとSlackメンバーの候補を表示。続けて名前を入力して絞り込み、カーソルの位置に挿入できます。表示名・本名・ユーザー名で検索でき、全角・半角やひらがな・カタカナの違いも吸収します。</li>
        <li>コメントのいいねボタンを、文字に合うコンパクトなサイズへ調整しました。</li>
        <li>アーカイブに「人気順（いいね数）・新しい順・古い順」を追加しました。</li>
        <li>管理画面にオンラインの目安、最終アクセス、日報別PV・閲覧者数を追加しました。アクセスの計測はこの更新から開始します。</li>
        <li>メンバー一覧を登録順（古い順・新しい順）や名前順で並び替えられるようにしました。</li>
        <li>パッチノートとクレジットを追加しました。</li>
        <li>本文のメンション候補にSlackユーザーグループを追加。グループ名・ハンドル名で検索して、公開時にグループへ通知できます。</li>
        <li>コメント欄を30秒ごとに自動更新し、Slackからの返信・画像・動画を反映します。動画再生中は更新を待ちます。</li>
        <li>Webで添付した動画をSlackの日報スレッドにも配信。Slack上で再生でき、動画の削除・日報のアーカイブも反映します。</li>
      </ul>
    </section>
    <section className="admin-panel" aria-labelledby="media-release"><p className="release-date">2026年10月22〜23日 · Slack連携・メディア対応</p><h2 id="media-release">日報とコメントを、SlackからもWebからも</h2>
      <ul>
        <li>画像を削除して再投稿した際のSlack二重公開を修正。既存の投稿を更新するようにし、直近の重複投稿を整理しました。</li>
        <li>Slackで過去の日報画像が表示できなくなる問題を修正しました。</li>
        <li>動画添付を改善し、MP4・WebMに加えてMOVにも対応。下書き中も画像や動画をプレビューできます。</li>
        <li>Slackの返信に添付した画像・動画をWebのコメントにも表示。取得可能な過去の画像・動画も取り込みました。</li>
        <li>Hanabi Log導入前にSlackへ直接書かれた日報を、コメントやスタンプとともに過去の日報として取り込みました。</li>
        <li>WebからSlackメンションを指定でき、日報チャンネルでの公開時に相手へ通知できるようにしました。</li>
        <li>コメントにもいいねできるようにしました。コメントについたスタンプ・いいねは日報投稿者とコメント投稿者の両方に反映します。同じ人が両方を兼ねる場合は重複して加算しません。</li>
        <li>内容カテゴリに「留学・進路」を追加しました。</li>
      </ul>
    </section>
    <p className="release-date">以下の過去の更新はコミット履歴から再構成しています。日付は開発上の記録日です。</p>
    {releaseHistory.map(release => <section key={release.id} className="admin-panel" aria-labelledby={`release-${release.id}`}>
      <p className="release-date">{release.date}</p><h2 id={`release-${release.id}`}>{release.title}</h2>
      <ul>{release.changes.map(change => <li key={change}>{change}</li>)}</ul>
    </section>)}
    <section className="admin-panel" aria-labelledby="credits"><h2 id="credits">クレジット</h2><dl className="credits-list">
      <dt>企画・運営</dt><dd>FRC Team Hanabi</dd>
      <dt>開発</dt><dd>山西遥斗（Haruto Yamanishi） · <a href="https://x.com/haruroute1107" target="_blank" rel="noreferrer">X @haruroute1107</a> · <a href="https://github.com/haruto-yamanishi" target="_blank" rel="noreferrer">GitHub @haruto-yamanishi</a></dd>
      <dt>開発支援</dt><dd>OpenAI Codex</dd>
      <dt>フィードバック・日々の記録</dt><dd>Hanabiメンバーのみなさん</dd>
      <dt>アプリケーション</dt><dd>Next.js / React / TypeScript / Auth.js</dd>
      <dt>データ・ホスティング</dt><dd>Supabase / PostgreSQL / Vercel</dd>
      <dt>連携サービス</dt><dd>Slack / Notion</dd>
    </dl></section>
  </div>;
}
