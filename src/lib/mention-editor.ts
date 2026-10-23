export interface MentionUser { id: string; name: string; realName?: string; username?: string; kind?: "user" | "group"; memberCount?: number }

export interface MentionDirectory { members: MentionUser[]; groupStatus: "available" | "missing_scope" | "unavailable" | "unsupported" }

export function normalizeMentionSearch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja").replace(/\s/g, "")
    .replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

export function matchesMention(user: MentionUser, query: string): boolean {
  const key = normalizeMentionSearch(query);
  return [user.name, user.realName ?? "", user.username ?? ""].some(value => normalizeMentionSearch(value).includes(key));
}

// Keep Slack IDs in storage, while the editor displays ordinary @names.
export function mentionDocument(raw: string) {
  const mentions: { start: number; end: number; token: string }[] = [];
  const text = raw.replace(/@\[([^\]\n]+)\]\(slack:([A-Z0-9]+)\)/g, (token, name: string, _id: string, offset: number) => {
    const removed = mentions.reduce((total, item) => total + item.token.length - (item.end - item.start), 0);
    const start = offset - removed;
    mentions.push({ start, end: start + name.length + 1, token });
    return `@${name}`;
  });
  function slice(start: number, end: number) {
    let result = "";
    let position = start;
    for (const mention of mentions) {
      if (mention.start >= start && mention.end <= end) {
        result += text.slice(position, mention.start) + mention.token;
        position = mention.end;
      }
    }
    return result + text.slice(position, end);
  }
  return { text, mentions, slice };
}

export function editMentionText(raw: string, next: string): string {
  const doc = mentionDocument(raw);
  let start = 0;
  while (start < doc.text.length && start < next.length && doc.text[start] === next[start]) start++;
  let oldEnd = doc.text.length;
  let newEnd = next.length;
  while (oldEnd > start && newEnd > start && doc.text[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
  // A partially edited mention becomes plain text instead of notifying the wrong person.
  for (const mention of doc.mentions) {
    if (mention.start < start && start < mention.end) start = mention.start;
    if (mention.start < oldEnd && oldEnd < mention.end) {
      newEnd += mention.end - oldEnd;
      oldEnd = mention.end;
    }
  }
  return doc.slice(0, start) + next.slice(start, newEnd) + doc.slice(oldEnd, doc.text.length);
}
