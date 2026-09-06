"use client";

import { useEffect, useState } from "react";

export function WebAppSupport() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch((error) => {
        console.error("Offline screen registration failed", error);
      });
    }
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return offline ? <div className="offline-banner" role="status">接続が切れています。入力内容を残したまま、ネットワークの復旧をお待ちください。</div> : null;
}
