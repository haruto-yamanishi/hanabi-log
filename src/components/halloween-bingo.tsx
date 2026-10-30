"use client";
import { useHalloween } from "@/components/seasonal/halloween-provider";
import { PumpkinArt } from "@/components/seasonal/halloween-art";
import { useEffect, useRef, useState } from "react";
import styles from "./halloween-bingo.module.css";
type Entry = { member_id:string; display_name:string; qualified_at:string };
export function HalloweenBingo() {
  const halloween = useHalloween();
  const dialog = useRef<HTMLDialogElement>(null);
  const [entries,setEntries] = useState<Entry[]>([]);
  const [error,setError] = useState(false);
  const [loaded,setLoaded] = useState(false);
  const [open,setOpen] = useState(false);
  const [visible,setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => { setVisible(Date.now() < Date.parse("2026-11-07T15:00:00Z"));
    if (new URLSearchParams(window.location.search).get("bingo") === "1") setOpen(true); },0);
    return () => clearTimeout(timer);
  },[]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/bingo",{signal:controller.signal,cache:"no-store"});
        if (!response.ok) throw new Error();
        setEntries((await response.json()).entries); setError(false); setLoaded(true);
      } catch { if (!controller.signal.aborted) setError(true); }
    }
    void refresh(); const timer=setInterval(() => void refresh(),30000);
    return () => { controller.abort(); clearInterval(timer); };
  },[open]);
  if (!visible) return null;
  return <>
    <button className={styles.badge} onClick={() => setOpen(true)} title="お土産Halloweenビンゴの参加者" aria-label="お土産Halloweenビンゴの参加者を見る">{halloween ? <PumpkinArt /> : null}<span>Halloween bingo</span></button>
    <dialog ref={dialog} className={styles.dialog} onClose={() => setOpen(false)} aria-labelledby="bingo-title">
      <div className={styles.heading}><span>HANABI · LITTLE HALLOWEEN</span><button onClick={() => dialog.current?.close()} aria-label="閉じる">×</button></div>
      <h2 id="bingo-title">{halloween ? <PumpkinArt /> : null}お土産ビンゴ</h2>
      <p>11/6（金）19:00の定例で開催。日報を一度書いて、挑戦権をゲット！</p>
      <p className={styles.note}>10/30の宣言後〜11/6 19:00 JSTまでの公開日報が対象。Slackからの投稿も、すでに書いてくれた分も含みます。</p>
      <h3>挑戦権を獲得した人 {loaded ? <small>{entries.length}人</small> : null}</h3>
      {error ? <p role="alert">読み込めませんでした。30秒後に再試行します。</p> : !loaded ? <p role="status">読み込み中…</p> : entries.length === 0 ? <p>最初の参加者を待っています。</p> : <ul className={styles.list}>{entries.map(e => <li key={e.member_id}><span>{e.display_name}</span><small>参加権獲得 ✓</small></li>)}</ul>}
      <p className={styles.note}>参加者は自動更新。獲得のお知らせはランダムチャットの告知スレッドへ。</p>
    </dialog>
  </>;
}
