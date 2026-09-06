"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const DISMISSED_KEY = "hanabi-install-dismissed-at";
const INSTALLED_KEY = "hanabi-installed";
const safePages = new Set(["/", "/me", "/archive", "/calendar"]);

function stored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Session suppression still applies. */ }
}
function standalone() {
  return window.matchMedia("(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function InstallPrompt() {
  const pathname = usePathname();
  const deferred = useRef<InstallEvent | null>(null);
  const suppressed = useRef(false);
  const [kind, setKind] = useState<"chromium" | "safari" | null>(null);
  const [visible, setVisible] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onInstallable = (event: Event) => {
      event.preventDefault();
      deferred.current = event as InstallEvent;
      setKind("chromium");
    };
    const onInstalled = () => {
      suppressed.current = true;
      save(INSTALLED_KEY, "true");
      deferred.current = null;
      setVisible(false);
    };
    const displayMode = window.matchMedia("(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen)");
    const onDisplayMode = () => { if (standalone()) onInstalled(); };
    const ua = navigator.userAgent;
    const safariVersion = Number(ua.match(/Version\/(\d+)/)?.[1] ?? 0);
    const setupTimer = window.setTimeout(() => {
      if (/Macintosh/.test(ua) && navigator.maxTouchPoints === 0 && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua) && safariVersion >= 17) {
        setKind("safari");
      }
      if (standalone()) onInstalled();
    }, 0);
    window.addEventListener("beforeinstallprompt", onInstallable);
    window.addEventListener("appinstalled", onInstalled);
    displayMode.addEventListener("change", onDisplayMode);
    return () => {
      window.clearTimeout(setupTimer);
      window.removeEventListener("beforeinstallprompt", onInstallable);
      window.removeEventListener("appinstalled", onInstalled);
      displayMode.removeEventListener("change", onDisplayMode);
    };
  }, []);

  useEffect(() => {
    let readySince = 0;
    const check = () => {
      const dismissed = Number(stored(DISMISSED_KEY));
      const blocked = !kind || !safePages.has(pathname) || suppressed.current || standalone() ||
        stored(INSTALLED_KEY) === "true" || (dismissed > 0 && Date.now() - dismissed < INSTALL_DISMISS_MS) ||
        document.visibilityState !== "visible" || document.readyState !== "complete" ||
        Boolean(document.querySelector(".initial-loading, main [aria-busy='true']")) ||
        Boolean(document.activeElement?.matches("input, textarea, select, [contenteditable='true']"));
      if (blocked) {
        readySince = 0;
        setVisible(false);
      } else {
        if (!readySince) readySince = Date.now();
        if (Date.now() - readySince >= 1500) setVisible(true);
      }
    };
    const timer = window.setInterval(check, 500);
    window.addEventListener("focusin", check);
    return () => { window.clearInterval(timer); window.removeEventListener("focusin", check); };
  }, [kind, pathname]);

  function dismiss() {
    suppressed.current = true;
    save(DISMISSED_KEY, String(Date.now()));
    setVisible(false);
  }

  async function install() {
    if (kind === "safari") { setInstructions(true); return; }
    const event = deferred.current;
    if (!event || busy) return;
    deferred.current = null;
    setBusy(true);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") save(INSTALLED_KEY, "true");
      dismiss();
    } catch {
      // The browser can withdraw an install event. Wait for a fresh event.
      setKind(null);
      setVisible(false);
    } finally {
      setBusy(false);
    }
  }

  if (!visible || !safePages.has(pathname)) return null;
  const mac = /Macintosh/.test(navigator.userAgent);
  return (
    <aside aria-labelledby="install-title" className="install-card">
      <p className="install-card__brand">Hanabi LOG</p>
      <h2 id="install-title">{instructions ? "SafariでDockに追加できます" : mac ? "Hanabi LOGをDockに追加" : "Hanabi LOGをアプリに追加"}</h2>
      {instructions ? <p>macOS Sonoma以降のSafariで「ファイル」→「Dockに追加」を選択してください。</p> : <p>ブラウザを開かず、アプリのようにすぐアクセスできます。</p>}
      <div className="install-card__actions">
        <button className="button button--ghost button--small" onClick={dismiss} type="button">{instructions ? "閉じる" : "あとで"}</button>
        {!instructions ? <button className="button button--primary button--small" disabled={busy} onClick={() => void install()} type="button">追加する</button> : null}
      </div>
    </aside>
  );
}
