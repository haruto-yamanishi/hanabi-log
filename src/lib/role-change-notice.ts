import type { Member } from "@/lib/types";

/** The actor is authenticated by the API; escape their displayed name as Slack text. */
export function roleChangeNotice(role: Member["role"], actorName: string, actorSlackUserId: string): string {
  const name = actorName.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const actor = `admin <@${actorSlackUserId}>（${name}）`;
  if (role === "media") {
    return `Hanabi Logから権限変更のお知らせです。\n${actor}によってあなたにmediaメンバーの権限が付与されました。\n\n今回のアップデートでは、日報の詳細からX・Instagram・note・IGNITERS・その他への掲載許可を依頼できます。依頼は日報の投稿者にDMで届き、原文のまま許可・自分で校正・校正依頼・拒否から選んでもらえます。校正が必要な場合は、投稿本文とURLを送って最終確認を依頼できます。日報とコメントの画像・動画もメディア欄で確認できます。`;
  }
  if (role === "admin") {
    return `Hanabi Logから権限変更のお知らせです。\n${actor}によってあなたにadmin権限が付与されました。管理画面でメンバーの権限と掲載許可の運用を管理できます。`;
  }
  return `Hanabi Logから権限変更のお知らせです。\n${actor}によってあなたの権限がmemberに変更されました。引き続き日報の投稿や閲覧ができます。`;
}
