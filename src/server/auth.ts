import "server-only";
import { getServerSession, type NextAuthOptions, type User } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import SlackProvider, { type SlackProfile } from "next-auth/providers/slack";
import type { CurrentUser, MemberRole } from "@/lib/types";
import { env, isDemoMode } from "@/server/env";
import { AppError } from "@/server/errors";
import { getDemoMember } from "@/server/repositories/memory";
import { getReportRepository } from "@/server/repositories";

process.env.NEXTAUTH_URL ??=
  env.APP_BASE_URL ?? `http://localhost:${process.env.PORT ?? "3000"}`;

interface SlackIdentity {
  slackTeamId: string;
  slackUserId: string;
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
}

function profileIdentity(profile: SlackProfile | undefined): SlackIdentity | null {
  if (!profile) return null;
  const slackTeamId = profile["https://slack.com/team_id"];
  const slackUserId = profile["https://slack.com/user_id"];
  if (!slackTeamId || !slackUserId) return null;
  return {
    slackTeamId,
    slackUserId,
    displayName: profile.name || "Slack member",
    email: profile.email ?? null,
    avatarUrl: profile.picture ?? null,
  };
}

function userIdentity(user: User | undefined): SlackIdentity | null {
  if (!user?.slackTeamId || !user.slackUserId) return null;
  return {
    slackTeamId: user.slackTeamId,
    slackUserId: user.slackUserId,
    displayName: user.name || "Slack member",
    email: user.email ?? null,
    avatarUrl: user.image ?? null,
  };
}

function configuredRole(slackUserId: string): MemberRole {
  const admins = new Set(
    (env.ADMIN_SLACK_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return admins.has(slackUserId) ? "admin" : "member";
}

const expectedTeamId = env.SLACK_TEAM_ID ?? (isDemoMode ? "T_DEMO" : "");

export const authOptions: NextAuthOptions = {
  secret: env.AUTH_SECRET || (isDemoMode ? "hanabi-log-local-demo-secret" : undefined),
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login", error: "/login" },
  providers: isDemoMode
    ? [
        CredentialsProvider({
          id: "demo",
          name: "Demo",
          credentials: {},
          async authorize() {
            return {
              id: "U_DEMO",
              name: "HANABI Demo",
              email: null,
              image: null,
              slackTeamId: expectedTeamId,
              slackUserId: "U_DEMO",
              role: "admin",
            };
          },
        }),
      ]
    : [
        SlackProvider({
          clientId: env.SLACK_CLIENT_ID ?? "",
          clientSecret: env.SLACK_CLIENT_SECRET ?? "",
          authorization: { params: { scope: "openid profile email" } },
          checks: ["state", "nonce"],
          profile(profile) {
            return {
              id: profile.sub,
              name: profile.name,
              email: profile.email,
              image: profile.picture,
              slackTeamId: profile["https://slack.com/team_id"],
              slackUserId: profile["https://slack.com/user_id"],
            };
          },
        }),
      ],
  callbacks: {
    async signIn({ user, profile }) {
      const identity =
        userIdentity(user) ?? profileIdentity(profile as SlackProfile | undefined);
      return Boolean(identity && expectedTeamId && identity.slackTeamId === expectedTeamId);
    },
    async jwt({ token, user, profile }) {
      const identity =
        userIdentity(user) ?? profileIdentity(profile as SlackProfile | undefined);
      if (identity) {
        if (!expectedTeamId || identity.slackTeamId !== expectedTeamId) {
          throw new AppError("WORKSPACE_FORBIDDEN", "対象外のSlackワークスペースです", 403);
        }
        const member = await getReportRepository().upsertMember({
          ...identity,
          role: isDemoMode ? "admin" : configuredRole(identity.slackUserId),
        });
        token.memberId = member.id;
        token.slackUserId = member.slackUserId;
        token.role = member.role;
        token.name = member.displayName;
        token.picture = member.avatarUrl;
      } else if (typeof token.memberId === "string") {
        // Keep long-lived sessions in sync with role changes made by an Admin.
        const member = await getReportRepository().getMember(token.memberId);
        if (member) {
          token.slackUserId = member.slackUserId;
          token.role = member.role;
          token.name = member.displayName;
          token.picture = member.avatarUrl;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.memberId && token.slackUserId && token.role) {
        session.user.id = token.memberId;
        session.user.slackUserId = token.slackUserId;
        session.user.role = token.role;
        session.user.name = token.name ?? session.user.name;
        session.user.image = token.picture ?? null;
      }
      return session;
    },
  },
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getServerSession(authOptions);
  if (session?.user?.id && session.user.slackUserId && session.user.role) {
    return {
      id: session.user.id,
      slackUserId: session.user.slackUserId,
      displayName: session.user.name ?? "Slack member",
      role: session.user.role,
      avatarUrl: session.user.image,
    };
  }
  if (isDemoMode) {
    const member = getDemoMember();
    return {
      id: member.id,
      slackUserId: member.slackUserId,
      displayName: member.displayName,
      role: member.role,
      avatarUrl: member.avatarUrl,
    };
  }
  return null;
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("UNAUTHORIZED", "ログインが必要です", 401);
  return user;
}
