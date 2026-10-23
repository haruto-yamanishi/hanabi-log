import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/env", () => ({ env: { SUPABASE_SECRET_KEY: "test-secret" } }));
import { prepareSlackAttachments, slackMediaToken, validSlackMediaToken } from "./slack-media";
import type { Report } from "@/lib/types";

describe("Slack image capabilities", () => {
  it("binds the token to both attachment ID and storage object", () => {
    const token = slackMediaToken("id", "owner/photo");
    expect(validSlackMediaToken("id", "owner/photo", token)).toBe(true);
    expect(validSlackMediaToken("other", "owner/photo", token)).toBe(false);
    expect(validSlackMediaToken("id", "owner/other", token)).toBe(false);
    expect(validSlackMediaToken("id", "owner/photo", "bad")).toBe(false);
  });
  it("uses stable URLs without changing private Web read URLs", async () => {
    const report = { attachments: [{ id: "id", storagePath: "owner/photo", signedUrl: "temporary" }] } as Report;
    const prepared = await prepareSlackAttachments(report, "https://log.test");
    expect(prepared.attachments[0].signedUrl).toContain("https://log.test/api/slack-media/id?token=");
    expect(report.attachments[0].signedUrl).toBe("temporary");
  });
});
