"use client";

import { useEffect, useState } from "react";
import { HanabiLogo } from "@/components/logo";

export function InitialLoadingScreen() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const hide = () => setVisible(false);
    if (document.readyState === "complete") {
      const timeout = window.setTimeout(hide, 0);
      return () => window.clearTimeout(timeout);
    }
    window.addEventListener("load", hide, { once: true });
    return () => window.removeEventListener("load", hide);
  }, []);

  if (!visible) return null;

  return (
    <div aria-busy="true" aria-label="読み込んでいます" className="initial-loading" role="status">
      <div className="initial-loading__logo">
        <HanabiLogo className="initial-loading__image" />
        <svg aria-hidden="true" className="initial-loading__arch" viewBox="0 0 100 75">
          <path className="initial-loading__arch-cover" d="M 0 62 Q 50 -8 100 62" pathLength="1" />
          <path className="initial-loading__arch-progress" d="M 0 62 Q 50 -8 100 62" pathLength="1" />
        </svg>
      </div>
    </div>
  );
}
