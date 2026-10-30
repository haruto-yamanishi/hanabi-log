/** Link to the report's parent message with its thread selected. */
export function mentionThreadLink(channel: string, messageTs: string, permalink?: string | null): string {
  if (!/^[CG][A-Z0-9]+$/.test(channel) || !/^\d+\.\d+$/.test(messageTs)) throw new Error("INVALID_SLACK_MESSAGE");
  const url = new URL(permalink || `https://app.slack.com/archives/${channel}/p${messageTs.replace(".", "")}`);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".slack.com")) throw new Error("INVALID_SLACK_PERMALINK");
  url.searchParams.set("thread_ts", messageTs);
  url.searchParams.set("cid", channel);
  return url.toString();
}

export function appendMentionThreadLink(text: string, link: string): string {
  if (text.includes(`<${link}|`)) return text;
  return `${text}\n<${link}|Slackで日報のスレッドを開く>\n日報チャンネルに未参加で開けない場合は、チャンネルに参加するか、管理者に参加を依頼してください。Webの日報リンクからも本文を確認できます。`;
}
