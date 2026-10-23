import type { Metadata } from "next";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { safeInternalCallbackUrl } from "@/lib/navigation";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { getCurrentUser, googleLoginEnabled } from "@/server/auth";
import { HanabiLogo } from "@/components/logo";
import { SlackSignInButton } from "@/components/slack-sign-in-button";

export const metadata: Metadata = { title: "ログイン" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const callbackUrl = safeInternalCallbackUrl(params.callbackUrl);
  const user = await getCurrentUser();
  if (user) redirect(callbackUrl as Route);
  return (
    <main className="login-page">
      <section className="login-story" aria-label="Hanabi Logについて">
        <div aria-hidden="true" className="login-firework login-firework--one" />
        <div aria-hidden="true" className="login-firework login-firework--two" />
        <div className="login-story__content">
          <HanabiLogo className="login-wordmark" inverse />
          <h1>Hanabi Log</h1>
          <p>FRC Team Hanabi 部内日報</p>
        </div>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-card">
          <HanabiLogo className="login-card__logo" />
          <h2 id="login-title">おかえりなさい</h2>
          <p className="login-card__lead">チームのSlackアカウントでログインしてください。</p>
          {params.error ? <p role="alert">ログインできませんでした。Google認証は事前登録済みのアカウントのみ利用できます。解決しない場合は管理者に確認してください。</p> : null}
          <SlackSignInButton callbackUrl={callbackUrl} />
          {googleLoginEnabled ? <GoogleSignInButton callbackUrl={callbackUrl} /> : null}
          <div className="privacy-note">
            <span aria-hidden="true">●</span>
            <p><strong>非公開の部内サービスです</strong><br />対象のSlackワークスペースのメンバー、または事前登録済みのGoogleアカウントのみ利用できます。</p>
          </div>
          <p className="login-help">ログインできない場合はチームの管理者に確認してください。</p>
        </div>
      </section>
    </main>
  );
}
