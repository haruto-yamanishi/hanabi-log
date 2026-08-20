"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export function SlackSignInButton({ callbackUrl }: { callbackUrl: string }) {
  const [pending, setPending] = useState(false);

  async function handleSignIn(): Promise<void> {
    setPending(true);
    try {
      await signIn("slack", { callbackUrl });
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      className="slack-button"
      disabled={pending}
      onClick={handleSignIn}
      type="button"
    >
      <span aria-hidden="true" className="slack-logo">
        <i /><i /><i /><i />
      </span>
      {pending ? "Slackを開いています…" : "Slackでサインイン"}
    </button>
  );
}
