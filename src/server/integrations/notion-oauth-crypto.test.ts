import { describe, expect, it } from "vitest";
import {
  createNotionOAuthState,
  decryptNotionToken,
  encryptNotionToken,
  verifyNotionOAuthState,
} from "@/server/integrations/notion-oauth-crypto";

const key = Buffer.alloc(32, 7).toString("base64");

describe("Notion OAuth cryptography", () => {
  it("round-trips an encrypted token only in the same context", () => {
    const sealed = encryptNotionToken("secret-token", key, "notion:bot-1:access");
    expect(sealed).not.toContain("secret-token");
    expect(decryptNotionToken(sealed, key, "notion:bot-1:access")).toBe(
      "secret-token",
    );
    expect(() => decryptNotionToken(sealed, key, "notion:bot-2:access")).toThrow();
  });

  it("rejects invalid encryption key sizes", () => {
    expect(() => encryptNotionToken("token", "bad", "context")).toThrow(
      /32-byte/,
    );
  });

  it("signs state for one member and expires it", () => {
    const now = Date.UTC(2026, 7, 20, 8);
    const state = createNotionOAuthState("member-1", "auth-secret", now);
    expect(
      verifyNotionOAuthState(state, "member-1", "auth-secret", now + 1_000),
    ).toBe(true);
    expect(
      verifyNotionOAuthState(state, "member-2", "auth-secret", now + 1_000),
    ).toBe(false);
    expect(
      verifyNotionOAuthState(state, "member-1", "wrong-secret", now + 1_000),
    ).toBe(false);
    expect(
      verifyNotionOAuthState(`${state.slice(0, -1)}x`, "member-1", "auth-secret", now),
    ).toBe(false);
    expect(
      verifyNotionOAuthState(
        state,
        "member-1",
        "auth-secret",
        now + 10 * 60 * 1_000 + 1,
      ),
    ).toBe(false);
  });
});
