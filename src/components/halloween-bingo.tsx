"use client";
import { useHalloween } from "@/components/seasonal/halloween-provider";
import { PumpkinArt } from "@/components/seasonal/halloween-art";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api-client";
import { BingoMachine } from "./bingo-machine";
import { BINGO_COLUMNS, bingoLines, bingoReachCount, type BingoAction, type BingoRule, type BingoSnapshot } from "@/lib/bingo";
import styles from "./halloween-bingo.module.css";

export function HalloweenBingo() {
  const halloween = useHalloween();
  const dialog = useRef<HTMLDialogElement>(null);
  const clock = useRef({ server: 0, local: 0 });
  const lastSnapshot = useRef(0);
  const autoOpened = useRef(false);
  const seenSequence = useRef(0);
  const refreshNow = useRef<() => void>(() => {});
  const drawRequest = useRef<{ requestId: string; expectedSequence: number } | null>(null);
  const [state, setState] = useState<BingoSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [now, setNow] = useState(0);
  const [rule, setRule] = useState<BingoRule>("report-support");
  const [confirmFinish, setConfirmFinish] = useState(false);

  const accept = useCallback((next: BingoSnapshot) => {
    const server = Date.parse(next.serverTime);
    if (!Number.isFinite(server) || server < lastSnapshot.current) return;
    lastSnapshot.current = server;
    clock.current = { server, local: performance.now() };
    setNow(server);
    setState(next);
    setError(null);
    const nextDraw = next.draws.at(-1);
    if (next.game.status === "live" && (!autoOpened.current || (next.draws.length > seenSequence.current && nextDraw && Date.parse(nextDraw.revealAt) > server))) {
      autoOpened.current = true; setOpen(true);
      requestAnimationFrame(() => dialog.current?.scrollTo({ top: 0, behavior: "instant" }));
    }
    seenSequence.current = next.draws.length;
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(Date.now() < Date.parse("2026-11-07T15:00:00Z"));
      if (new URLSearchParams(window.location.search).get("bingo") === "1") setOpen(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!visible) return;
    let stopped = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    let live = false;
    async function refresh() {
      if (stopped || pending) return;
      clearTimeout(timer);
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 12_000);
      try {
        const next = await apiRequest<BingoSnapshot>("/api/bingo", { signal: controller.signal, cache: "no-store" });
        if (!stopped) { live = next.game.status === "live"; accept(next); }
      } catch {
        if (!stopped) setError("接続を確認しています。カードは保持され、自動で再接続します。");
      } finally {
        clearTimeout(timeout); pending = false;
        if (!stopped) timer = setTimeout(refresh, document.hidden ? 15_000 : live ? 1000 : 4000);
      }
    }
    function onVisible() { if (!document.hidden) void refresh(); }
    refreshNow.current = () => void refresh();
    void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => { stopped = true; controller?.abort(); clearTimeout(timer); refreshNow.current = () => {}; document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("online", onVisible); };
  }, [visible, accept]);
  useEffect(() => {
    if (open && visible && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open, visible]);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => { if (clock.current.server) setNow(clock.current.server + performance.now() - clock.current.local); }, 100);
    return () => clearInterval(timer);
  }, [open]);

  async function act(action: BingoAction) {
    if (busy) return;
    setBusy(true); setActionError(null);
    try {
      const next = await apiRequest<BingoSnapshot>("/api/bingo", { method: "POST", body: JSON.stringify(action), signal: AbortSignal.timeout(15_000) });
      accept(next); drawRequest.current = null; setConfirmFinish(false);
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "操作を確認できませんでした。状態を確認して再試行してください。"); refreshNow.current(); }
    finally { setBusy(false); }
  }
  function draw() {
    const sequence = state?.draws.length ?? 0;
    if (!drawRequest.current || drawRequest.current.expectedSequence !== sequence) drawRequest.current = { expectedSequence: sequence, requestId: crypto.randomUUID() };
    void act({ action: "draw", ...drawRequest.current });
  }
  if (!visible) return null;
  const latest = state?.draws.at(-1);
  const revealed = state?.draws.filter(draw => draw.number !== null && Date.parse(draw.revealAt) <= now) ?? [];
  const called = new Set(revealed.map(draw => draw.number!));
  const lines = state?.card ? bingoLines(state.card.cells, called) : [];
  const winningCells = new Set(lines.flat());
  const reach = state?.card ? bingoReachCount(state.card.cells, called) : 0;
  const running = Boolean(latest && (now < Date.parse(latest.revealAt) + 1500 || latest.number === null));
  const lastNumber = revealed.at(-1)?.number;

  return <>
    <button className={styles.badge} onClick={() => setOpen(true)} title="お土産Halloweenビンゴ" aria-label="お土産Halloweenビンゴの参加者を見る">{halloween ? <PumpkinArt /> : null}<span>{state?.game.status === "live" ? "ビンゴ開催中 · カードを開く" : "Halloween bingo"}</span></button>
    <dialog ref={dialog} className={styles.dialog} onClose={() => setOpen(false)} aria-labelledby="bingo-title">
      <div className={styles.heading}><span>HANABI · HALLOWEEN BINGO</span><button onClick={() => dialog.current?.close()} aria-label="閉じる">×</button></div>
      <h2 id="bingo-title">{halloween ? <PumpkinArt /> : null}お土産ビンゴ</h2>
      <p className={styles.intro}>{state?.game.status === "live" ? "みんなで同じ番号を抽選中。カードは自動で開きます。" : state?.game.status === "finished" ? "ビンゴは終了しました。カードと結果はこのまま確認できます。" : "11/6（金）19:00の定例で開催。カードを用意して待っていてね。"}</p>
      {error ? <p role="status" className={styles.connection}>{error} <button onClick={() => refreshNow.current()}>再接続</button></p> : null}
      {!state ? <p role="status">ビンゴを読み込んでいます…</p> : <>
        <div className={styles.playArea}>
          <section className={styles.machinePanel} aria-label="抽選機">
            <BingoMachine draw={latest} now={now} />
            <p className={styles.round}>{revealed.length} / 75 球</p>
            {state.canHost && <div className={styles.controls}>
              {state.game.status === "waiting" ? <>
                <label htmlFor="bingo-rule">抽選ルール</label>
                <select id="bingo-rule" value={rule} onChange={event => setRule(event.target.value as BingoRule)} disabled={busy}>
                  <option value="report-support">日報応援抽選</option><option value="uniform">全番号を均等に抽選</option>
                </select>
                <p className={styles.note}>開始時に参加者と投稿回数を確定します。開始後のカード配り直しはできません。</p>
                <button className={styles.primary} disabled={busy || Boolean(error) || state.entries.length === 0} onClick={() => void act({ action: "start", rule })}>全員の画面でビンゴを開始</button>
              </> : state.game.status === "live" ? <>
                <button className={styles.primary} disabled={busy || Boolean(error) || running || state.draws.length >= 75} onClick={draw}>{busy ? "送信中…" : running ? "抽選・発表中…" : state.draws.length >= 75 ? "全75球を抽選しました" : "ガラガラを回す"}</button>
                {!confirmFinish ? <button className={styles.finish} disabled={busy || running} onClick={() => setConfirmFinish(true)}>ビンゴを終了する</button> : <div className={styles.finishConfirm}><p>全員の抽選を終了しますか？ 再開はできません。</p><button disabled={busy || running} onClick={() => void act({ action: "finish", expectedSequence: state.draws.length })}>終了する</button><button onClick={() => setConfirmFinish(false)}>戻る</button></div>}
              </> : null}
              {actionError ? <p role="alert">{actionError}</p> : null}
            </div>}
          </section>
          <section className={styles.cardPanel} aria-label="あなたのビンゴカード">
            {state.card ? <>
              <div className={styles.cardHeading}><span>YOUR LUCKY CARD</span><strong aria-live="polite">{lines.length ? `BINGO! ${lines.length}ライン` : reach ? `リーチ！ ${reach}ライン` : "真ん中は FREE"}</strong></div>
              <div className={styles.card} role="table" aria-label="5×5ビンゴカード">
                <div className={styles.cardRow} role="row">{BINGO_COLUMNS.map(letter => <span className={styles.column} role="columnheader" key={letter}>{letter}</span>)}</div>
                {Array.from({ length: 5 }, (_, row) => <div className={styles.cardRow} role="row" key={row}>{state.card!.cells.slice(row * 5, row * 5 + 5).map((number, col) => {
                  const index = row * 5 + col;
                  const marked = number === 0 || called.has(number);
                  return <div role="cell" key={index} className={`${styles.cell} ${marked ? styles.marked : ""} ${winningCells.has(index) ? styles.winning : ""} ${number !== 0 && number === lastNumber ? styles.justMarked : ""}`} data-number={number} data-marked={marked} aria-label={number === 0 ? "中央 FREE 開いています" : `${number}${marked ? " 開いています" : ""}`}><span>{number === 0 ? "FREE" : number}</span>{marked && <small aria-hidden="true">✓</small>}</div>;
                })}</div>)}
              </div>
              <p className={styles.note}>カードはあなた専用。再読み込みしても同じカードです。{state.game.rule === "report-support" ? ` 対象の日報：${state.card.reportCount}回${state.game.status === "waiting" ? "（開始時に確定）" : ""}` : ""}</p>
            </> : <div className={styles.spectator}><strong>{state.canHost ? "あなたは主催者です" : "いっしょに抽選を見守ろう"}</strong><p>{state.game.status === "waiting" ? "参加権を獲得すると、ここに自分のカードが届きます。" : "今回は観覧モードです。参加カードは開始時に確定しています。"}</p></div>}
          </section>
        </div>
        <section className={styles.history} aria-label="出た番号"><h3>これまでの番号</h3><div>{revealed.length ? revealed.map(draw => <span key={draw.sequence}>{draw.number}</span>) : <p>まだ番号は出ていません。</p>}</div></section>
        {state.winners.length > 0 && <section className={styles.winners} aria-label="ビンゴ達成者"><h3>ビンゴ、おめでとう！</h3><ol>{state.winners.map(winner => <li key={winner.memberId}><strong>{winner.displayName}</strong><span>第{winner.winningDraw}球 · {winner.lines}ライン</span></li>)}</ol><p className={styles.note}>同じ球でビンゴになった人は同着です。</p></section>}
        <details className={styles.details}><summary>参加者 {state.entries.length}人・ルール</summary>
          <p>10/30の宣言後〜11/6 19:00 JSTまでに公開した日報で参加権を獲得できます。Slackからの投稿も対象です。ゲーム開始時に参加者を確定します。</p>
          <ul className={styles.list}>{state.entries.map(entry => <li key={entry.member_id}><span>{entry.display_name}</span><small>参加権獲得 ✓</small></li>)}</ul>
        </details>
        <aside className={styles.rules} aria-label="抽選ルール"><strong>{state.game.status === "waiting" ? "開始前のルール案内" : state.game.rule === "report-support" ? "日報応援抽選" : "均等抽選"}</strong>
          <p>{state.game.status === "waiting" || state.game.rule === "report-support" ? "日報応援抽選では、10/20〜10/31（日本時間）に公開した日報の回数に応じて、その人のカードの番号を少し出やすくします。2〜5回で段階的に加点し、番号ごとの抽選の重みは最大15%増。投稿回数はほかの参加者には表示しません。" : "残っているすべての番号を同じ確率で抽選します。"}</p>
          <p>中央は最初からオープン。縦・横・斜めのどれかがそろうとビンゴ！ 番号は重複しません。</p>
        </aside>
      </>}
    </dialog>
  </>;
}
