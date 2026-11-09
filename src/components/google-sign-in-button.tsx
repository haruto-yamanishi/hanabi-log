"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export function GoogleSignInButton({ callbackUrl }: { callbackUrl: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  return <>
    <button className="slack-button" disabled={pending} type="button" onClick={async () => {
      setPending(true);
      setError(false);
      try {
        await signIn("google", { callbackUrl });
      } catch {
        setError(true);
      } finally {
        setPending(false);
      }
    }}>{pending ? "Googleを開いています…" : "Googleでサインイン（登録済みメンター）"}</button>
    {error ? <p role="alert">ログインを開始できませんでした。もう一度お試しください。</p> : null}
  </>;
}
