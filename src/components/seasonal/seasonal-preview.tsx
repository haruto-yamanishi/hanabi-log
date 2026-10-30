"use client";
import { useEffect } from "react";
import { useSeasonalPreview } from "./halloween-provider";
import type { SeasonalScene } from "@/lib/seasonal-scene";

export function SeasonalPreview() {
  const { preview, setPreview } = useSeasonalPreview();
  useEffect(() => () => setPreview(null), [setPreview]);
  return <section className="admin-panel" aria-labelledby="seasonal-preview-heading">
    <div className="admin-panel__heading"><div><h2 id="seasonal-preview-heading">季節アセットの確認</h2><p>この画面だけのプレビューです。他のユーザーには影響せず、管理画面を離れると自動表示に戻ります。</p></div></div>
    <label>表示する季節 <select value={preview ?? "auto"} onChange={event => setPreview(event.target.value === "auto" ? null : event.target.value as SeasonalScene)}>
      <option value="auto">日付に合わせる（日本時間）</option>
      <option value="halloween">ハロウィン（10/20〜10/31）</option>
      <option value="autumn">紅葉・落ち葉（11/1〜11/30）</option>
      <option value="winter">雪・雪だるま（12/1〜12/10）</option>
      <option value="christmas">雪・雪だるま・サンタのそり（12/11〜12/25）</option>
      <option value="none">演出なし</option>
    </select></label>
    <p role="status">{preview === null ? "日付に合わせて表示しています。" : "自分の画面でプレビュー中"}</p>
  </section>;
}
