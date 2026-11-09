import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    APP_BASE_URL: "http://localhost:3000", SLACK_TEAM_ID: "T_TEAM",
    GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_MENTOR_ACCOUNTS: '{"mentor@example.com":"U123"}',
    ADMIN_SLACK_USER_IDS: "U123",
  },
  upsertMember: vi.fn(),
  getMember: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/env", () => ({ env: mocks.env, isDemoMode: false }));
vi.mock("@/server/repositories", () => ({ getReportRepository: () => mocks }));
import { authOptions } from "./auth";
import { googleSlackUserId, verifiedGoogleIdentity } from "./google-access";

const profile = { sub: "google-id", email: "Mentor@example.com", email_verified: true, name: "Mentor" };
const member = { id: "member-1", slackTeamId: "T_TEAM", slackUserId: "U123", role: "member", isActive: true, displayName: "Mentor" };
// Exercise NextAuth callbacks with the same provider/profile combinations sent by OAuth.
const jwt = (args: Record<string, unknown>) => authOptions.callbacks!.jwt!(args as never);
const signIn = (args: Record<string, unknown>) => authOptions.callbacks!.signIn!(args as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.GOOGLE_MENTOR_ACCOUNTS = '{"mentor@example.com":"U123"}';
  mocks.upsertMember.mockResolvedValue(member);
  mocks.getMember.mockResolvedValue(member);
});

describe("restricted Google authentication", () => {
  it("accepts only an exact verified allowlisted email", async () => {
    expect(await signIn({ account: { provider: "google" }, profile })).toBe(true);
    for (const changes of [{ email_verified: false }, { email_verified: "true" }, { email: "other@example.com" }, { email: "mentor+alias@example.com" }, { sub: "" }]) {
      expect(await signIn({ account: { provider: "google" }, profile: { ...profile, ...changes } })).toBe(false);
    }
    expect(verifiedGoogleIdentity(mocks.env.GOOGLE_MENTOR_ACCOUNTS, undefined)).toBeNull();
  });

  it("fails closed for missing, invalid or ambiguous configuration", () => {
    for (const config of [undefined, "", "bad json", "[]", "null", '{"mentor@example.com":"admin"}', '{"mentor@example.com":"U123","MENTOR@example.com":"U456"}']) {
      expect(googleSlackUserId(config, profile.email)).toBeNull();
    }
  });

  it("links the configured Slack identity without bootstrapping admin access", async () => {
    const token = await jwt({ token: {}, account: { provider: "google" }, profile });
    expect(mocks.upsertMember).toHaveBeenCalledWith(expect.objectContaining({ slackUserId: "U123", slackTeamId: "T_TEAM", role: "member" }));
    expect(token).toMatchObject({ memberId: "member-1", authProvider: "google", googleEmail: "mentor@example.com" });
  });

  it("refuses unverified profiles even if the JWT callback is reached", async () => {
    expect(await jwt({ token: {}, account: { provider: "google" }, profile: { ...profile, email_verified: false } })).toEqual({});
    expect(mocks.upsertMember).not.toHaveBeenCalled();
  });

  it("revokes existing sessions when permission is removed or mapped to another Slack account", async () => {
    const token = await jwt({ token: {}, account: { provider: "google" }, profile });
    for (const config of ["{}", '{"mentor@example.com":"U456"}']) {
      mocks.env.GOOGLE_MENTOR_ACCOUNTS = config;
      expect(await jwt({ token })).toEqual({});
    }
  });

  it("refreshes existing permissions and revokes deleted members", async () => {
    const token = await jwt({ token: {}, account: { provider: "google" }, profile });
    mocks.getMember.mockResolvedValue({ ...member, role: "admin", isActive: false });
    expect(await jwt({ token })).toMatchObject({ role: "admin", isActive: false });
    mocks.getMember.mockResolvedValue(null);
    expect(await jwt({ token })).toEqual({});
  });

  it("keeps Slack workspace restrictions", async () => {
    expect(await signIn({ account: { provider: "slack" }, user: { slackTeamId: "T_OTHER", slackUserId: "U123" } })).toBe(false);
    expect(await signIn({ account: { provider: "slack" }, user: { slackTeamId: "T_TEAM", slackUserId: "U123" } })).toBe(true);
  });

  it("does not produce an authenticated session from a revoked token", async () => {
    const session = await authOptions.callbacks!.session!({ session: { user: { name: "Mentor" }, expires: "" }, token: {} } as never);
    expect(session.user).not.toHaveProperty("id");
  });
});
