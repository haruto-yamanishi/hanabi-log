"use client";
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { nextJstMidnight } from "@/lib/halloween-season";

import { seasonalSceneForDate, type SeasonalScene } from "@/lib/seasonal-scene";
import { SeasonalAtmosphere } from "./seasonal-atmosphere";

const HalloweenContext = createContext(false);
const PreviewContext = createContext<{ preview: SeasonalScene | null; setPreview: (scene: SeasonalScene | null) => void }>({ preview: null, setPreview: () => {} });
export function useSeasonalPreview() { return useContext(PreviewContext); }
function snapshot() {
  if (process.env.NODE_ENV === "development") {
    const preview = new URLSearchParams(window.location.search).get("halloween");
    if (preview === "on" || preview === "off") return preview === "on" ? "halloween" : "none";
  }
  return seasonalSceneForDate(new Date());
}
function subscribe(update: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  function tick() {
    update();
    clearTimeout(timer);
    timer = setTimeout(tick, Math.max(1, nextJstMidnight(new Date()) - Date.now()));
  }
  tick();
  window.addEventListener("pageshow", tick);
  document.addEventListener("visibilitychange", tick);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("pageshow", tick);
    document.removeEventListener("visibilitychange", tick);
  };
}
// SSR and the first hydration render always agree. The browser activates the
// decoration immediately afterwards, without changing the loading timer.
const serverSnapshot = (): SeasonalScene => "none";
export function HalloweenProvider({ children }: { children: ReactNode }) {
  const automatic = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [preview, setPreview] = useState<SeasonalScene | null>(null);
  const scene = preview ?? automatic;
  const enabled = scene === "halloween";
  return <PreviewContext.Provider value={{ preview, setPreview }}><HalloweenContext.Provider value={enabled}><div className="seasonal-root" data-halloween={enabled}>{children}<SeasonalAtmosphere scene={scene} /></div></HalloweenContext.Provider></PreviewContext.Provider>;
}
export function useHalloween() { return useContext(HalloweenContext); }
