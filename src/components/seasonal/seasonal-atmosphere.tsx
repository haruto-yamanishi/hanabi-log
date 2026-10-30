import type { CSSProperties } from "react";
import type { SeasonalScene } from "@/lib/seasonal-scene";

export function SeasonalAtmosphere({ scene }: { scene: SeasonalScene }) {
  if (scene !== "autumn" && scene !== "winter" && scene !== "christmas") return null;
  return <div className={`seasonal-atmosphere seasonal-atmosphere--${scene}`} aria-hidden="true" data-season={scene}>
    {Array.from({ length: scene === "autumn" ? 12 : 20 }, (_, i) => <span className="seasonal-particle" key={i} style={{
      left: `${(i * 37 + 3) % 100}%`, "--duration": `${14 + i % 7 * 2}s`, "--delay": `${-i * 3}s`, "--drift": `${i % 2 ? -45 : 45}px`,
    } as CSSProperties}>{scene === "autumn" ? <svg viewBox="0 0 32 40"><path fill={i % 2 ? "#b86532" : "#cf973e"} d="M16 2C32 12 34 27 17 34C0 30 0 15 16 2Z"/><path d="M16 8L17 39M16 20L8 15M17 27L25 19" stroke="#85512e" fill="none" strokeWidth="1.5"/></svg> : null}</span>)}
    {scene !== "autumn" && <svg className="seasonal-snowman" viewBox="0 0 100 130">
      <path d="M25 85L5 65M75 85L95 63" stroke="#91725c" strokeWidth="4" strokeLinecap="round"/>
      <ellipse cx="50" cy="98" rx="31" ry="28" fill="#e6f0f4"/><circle cx="50" cy="55" r="23" fill="#f3f8fa"/>
      <path d="M27 38H73M35 37V15H64V37" stroke="#435970" strokeWidth="8" fill="#435970" strokeLinejoin="round"/>
      <path d="M31 76Q50 83 69 76M63 79L67 98" stroke="#b75b51" strokeWidth="9" fill="none"/>
      <g fill="#435970"><circle cx="42" cy="53" r="2"/><circle cx="58" cy="53" r="2"/><circle cx="50" cy="94" r="2"/><circle cx="50" cy="107" r="2"/></g>
      <path d="M49 58L64 62L49 65" fill="#d99551"/>
    </svg>}
    {scene === "christmas" && <svg className="seasonal-sleigh" viewBox="0 0 280 110">
      <path d="M95 79Q133 88 170 64" stroke="#aa9367" fill="none" strokeWidth="2"/>
      <path d="M17 66H91L104 46H114L103 85H30Z" fill="#a94d49"/>
      <path d="M18 93H104Q122 93 124 81M35 83V93M91 82V93" stroke="#bf9b59" strokeWidth="4" fill="none"/>
      <ellipse cx="53" cy="58" rx="19" ry="22" fill="#b9514d"/><circle cx="56" cy="30" r="12" fill="#f1cfac"/>
      <path d="M44 31Q56 57 69 31L65 46H48Z" fill="#fff8ed"/><path d="M42 21L57 3L73 23Z" fill="#b9514d"/><path d="M42 23H70" stroke="#fff8ed" strokeWidth="5"/><circle cx="58" cy="5" r="4" fill="#fff8ed"/>
      {[0, 57].map(x => <g key={x} transform={`translate(${x} 0)`} stroke="#8b6449" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M159 62L148 82M179 62L193 77M174 58L190 37" fill="none"/><ellipse cx="169" cy="57" rx="21" ry="11" fill="#a98059"/><path d="M187 40L195 29L209 36L200 44Z" fill="#a98059"/><path d="M194 29L190 13M190 22L182 17M190 21L198 13" fill="none"/><circle cx="207" cy="36" r="3" fill="#b9514d" stroke="none"/></g>)}
    </svg>}
  </div>;
}
