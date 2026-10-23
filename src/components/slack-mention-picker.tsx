"use client";
import { useEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { apiRequest } from "@/components/api-client";
import { editMentionText, matchesMention, mentionDocument, type MentionUser, type MentionDirectory } from "@/lib/mention-editor";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & { value: string; onValueChange: (value: string) => void };
let memberRequest: Promise<MentionDirectory | MentionUser[]> | undefined;
let memberRequestExpires = 0;
function fetchMembers() {
  if (Date.now() > memberRequestExpires) memberRequest = undefined;
  memberRequestExpires = Date.now() + 300_000;
  return memberRequest ??= apiRequest<MentionDirectory | MentionUser[]>("/api/integrations/slack/mentions").catch(error => { memberRequest = undefined; throw error; });
}

export function SlackMentionTextarea({ value, onValueChange, ...props }: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [users, setUsers] = useState<MentionUser[]>([]);
  const [groupStatus, setGroupStatus] = useState<MentionDirectory["groupStatus"]>("available");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [trigger, setTrigger] = useState<{ start: number; end: number; query: string } | null>(null);
  const [selected, setSelected] = useState(0);
  const composing = useRef(false);
  const doc = mentionDocument(value);
  const candidates = trigger ? users.filter(user => matchesMention(user, trigger.query)).slice(0, 30) : [];
  const listId = `${props.id}-mentions`;
  useEffect(() => {
    if (trigger) document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [selected, trigger, listId]);
  function detect(text: string, cursor: number) {
    const start = text.lastIndexOf("@", cursor - 1);
    const query = text.slice(start + 1, cursor);
    if (start < 0 || /[\n@]/.test(query) || query.length > 60 || doc.mentions.some(item => start === item.start && cursor >= item.end)) {
      setTrigger(null); return;
    }
    setTrigger({ start, end: cursor, query });
    setSelected(0);
    if (!loaded) void fetchMembers().then(result => { setUsers(Array.isArray(result) ? result : result.members); setGroupStatus(Array.isArray(result) ? "available" : result.groupStatus); setLoaded(true); setError(false); }).catch(() => setError(true));
  }
  function choose(user: MentionUser) {
    if (!trigger) return;
    const name = user.name.replace(/[\]\n]/g, " ");
    const next = doc.slice(0, trigger.start) + `@[${name}](slack:${user.id}) ` + doc.slice(trigger.end, doc.text.length);
    if (props.maxLength && next.length > props.maxLength) return;
    onValueChange(next);
    setTrigger(null);
    const position = trigger.start + name.length + 2;
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(position, position); });
  }
  return <div className="mention-editor">
    <textarea {...props} ref={textarea} value={doc.text} aria-autocomplete="list" aria-controls={trigger ? listId : undefined} aria-activedescendant={trigger && candidates[selected] ? `${listId}-${selected}` : undefined}
      onChange={event => { onValueChange(editMentionText(value, event.target.value)); detect(event.target.value, event.target.selectionStart); }}
      onClick={event => detect(event.currentTarget.value, event.currentTarget.selectionStart)}
      onBlur={() => setTrigger(null)}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={event => { composing.current = false; detect(event.currentTarget.value, event.currentTarget.selectionStart); }}
      onKeyDown={event => {
        if (!trigger || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") { event.preventDefault(); setTrigger(null); }
        else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && candidates.length) {
          event.preventDefault(); setSelected(index => (index + (event.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length);
        } else if ((event.key === "Enter" || event.key === "Tab") && candidates[selected]) { event.preventDefault(); choose(candidates[selected]); }
      }} />
    {trigger ? <div className="mention-menu">
      <div className="mention-menu__heading">メンバー・グループをメンション</div>
      <div id={listId} role="listbox" aria-label="Slackメンバー・グループ候補">
        {candidates.map((user, index) => <button key={user.id} id={`${listId}-${index}`} type="button" role="option" aria-selected={selected === index} onMouseDown={event => event.preventDefault()} onClick={() => choose(user)}>
          <span className="mention-menu__avatar" aria-hidden="true">{user.kind === "group" ? "＠" : user.name.slice(0, 1)}</span>
          <span><strong>{user.name}</strong>{user.kind === "group" ? <span className="mention-menu__group">グループ{user.memberCount ? ` · ${user.memberCount}人` : ""}</span> : null}<small>{[user.realName !== user.name ? user.realName : "", user.username ? `@${user.username}` : ""].filter(Boolean).join(" · ")}</small></span>
        </button>)}
      </div>
      {!candidates.length ? <p role="status">{error ? "メンバーを取得できませんでした。@を入力し直してください。" : !loaded ? "読み込み中…" : "一致するメンバー・グループがいません"}</p> : <small className="mention-menu__hint">↑↓で選択 · Enterで挿入 · Escで閉じる</small>}
      {groupStatus !== "available" ? <p role="status">{groupStatus === "missing_scope" ? "グループの取得にはSlackアプリのusergroups:read権限が必要です。" : groupStatus === "unsupported" ? "このワークスペースではユーザーグループを利用できません。" : "グループを取得できませんでした。時間をおいて再読み込みしてください。"}</p> : null}
    </div> : null}
  </div>;
}
