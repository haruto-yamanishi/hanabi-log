import { bingoColumn, type BingoDraw } from "@/lib/bingo";
import styles from "./halloween-bingo.module.css";

export function BingoMachine({ draw, now }: { draw?: BingoDraw; now: number }) {
  const start = draw ? Date.parse(draw.animationAt) : 0;
  const end = draw ? Date.parse(draw.revealAt) : 0;
  const spinning = Boolean(draw && now >= start && now < end);
  const number = draw && now >= end ? draw.number : null;
  const waiting = Boolean(draw && now < start);
  const offset = Math.max(0, now - start);
  return <div className={styles.machine} data-spinning={spinning} data-testid="bingo-machine">
    <svg viewBox="0 0 300 240" aria-hidden="true" className={styles.machineArt}>
      <ellipse cx="145" cy="224" rx="112" ry="10" fill="#2c263b" opacity=".07" />
      <path d="M78 209L101 106H173L197 209" fill="#e6d1a9" stroke="#9b7650" strokeWidth="5" strokeLinejoin="round" />
      <path d="M62 212H213" stroke="#875c3b" strokeWidth="12" strokeLinecap="round" />
      <path d="M195 90H224V133H240" fill="none" stroke="#b79560" strokeWidth="8" strokeLinecap="round" />
      <rect x="232" y="123" width="16" height="26" rx="8" fill="#92513c" />
      <g className={spinning ? styles.rotorSpinning : styles.rotor} style={spinning ? { transform: `rotate(${offset / 850 * 360}deg)` } : undefined}>
        <path d="M107 27H166L208 69V128L166 170H107L65 128V69Z" fill="#f8e9c9" stroke="#ba8c51" strokeWidth="5" />
        <path d="M107 27L166 170M166 27L107 170M65 69L208 128M65 128L208 69" stroke="#caa975" strokeWidth="3" opacity=".55" />
        {[[101, 82, "#ca6759"], [159, 65, "#75958a"], [165, 119, "#d9ad53"], [111, 128, "#8a81a3"], [137, 99, "#f6f2e7"]].map(([x, y, color], i) => <g key={i}><circle cx={x} cy={y} r="13" fill={String(color)} stroke="#ffffff99" strokeWidth="2" /><circle cx={Number(x) - 4} cy={Number(y) - 4} r="3" fill="#fff" opacity=".5" /></g>)}
        <circle cx="136.5" cy="98.5" r="7" fill="#b38a54" />
      </g>
      <path d="M182 148L215 179H264" fill="none" stroke="#b79560" strokeWidth="7" strokeLinecap="round" />
      <path d="M215 211H277L269 226H222Z" fill="#a66d49" />
      {number !== null && <g key={draw?.sequence} className={styles.deliveredBall} style={{ transform: `translate(${(1 - Math.min(1, Math.max(0, now - end) / 900)) * -55}px, ${(1 - Math.min(1, Math.max(0, now - end) / 900)) * -48}px)` }}>
        <circle cx="246" cy="197" r="19" fill="#fff9e9" stroke="#ca9b4e" strokeWidth="3" />
        <text x="246" y="203" textAnchor="middle" fill="#805229" fontSize="17" fontWeight="800">{number}</text>
      </g>}
    </svg>
    <div className={styles.drawResult} aria-live="polite" aria-atomic="true">
      <span>{spinning ? "ガラガラ… 抽選中" : waiting ? "まもなく抽選！" : draw && number === null ? "番号を確認しています…" : number !== null ? `第${draw?.sequence}球` : "次のラッキーナンバーは？"}</span>
      <strong data-testid="bingo-number">{number !== null ? <><small>{bingoColumn(number)}</small> {number}</> : "?"}</strong>
    </div>
  </div>;
}
