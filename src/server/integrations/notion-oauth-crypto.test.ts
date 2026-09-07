import { describe, expect, it } from "vitest";
import {
  createNotionStateToken,
  decryptNotionToken,
  decryptNotionTokenWithKeyring,
  encryptNotionToken,
  encryptNotionTokenWithKeyring,
  notionTokenNeedsRotation,
  verifyNotionStateToken,
} from "@/server/integrations/notion-oauth-crypto";

const key = Buffer.alloc(32, 7).toString("base64");
const oldKey = Buffer.alloc(32, 8).toString("base64");

describe("Notion OAuth cryptography", () => {
  it("round-trips an encrypted token only in the same context", () => {
    const sealed = encryptNotionToken("secret-token", key, "notion:bot-1:access");
    expect(sealed).not.toContain("secret-token");
    expect(decryptNotionToken(sealed, key, "notion:bot-1:access")).toBe(
      "secret-token",
    );
    expect(() => decryptNotionToken(sealed, key, "notion:bot-2:access")).toThrow();
  });

  it("writes v2 ciphertext with a key id and reads it through the keyring", () => {
    const keyring = { currentId: "2026-09", currentKey: key };
    const sealed = encryptNotionTokenWithKeyring(
      "secret-token",
      keyring,
      "notion:bot-1:access",
    );
    expect(sealed.startsWith("v2.2026-09.")).toBe(true);
    expect(decryptNotionTokenWithKeyring(sealed, keyring, "notion:bot-1:access")).toBe(
      "secret-token",
    );
    expect(notionTokenNeedsRotation(sealed, keyring)).toBe(false);
  });

  it("decrypts old v2 and legacy v1 ciphertext during rotation", () => {
    const oldKeyring = { currentId: "2025", currentKey: oldKey };
    const currentKeyring = {
      currentId: "2026",
      currentKey: key,
      decryptionKeys: { "2025": oldKey },
    };
    const oldV2 = encryptNotionTokenWithKeyring(
      "old-v2-token",
      oldKeyring,
      "notion:bot-1:access",
    );
    const legacy = encryptNotionToken(
      "legacy-token",
      oldKey,
      "notion:bot-1:access",
    );

    expect(
      decryptNotionTokenWithKeyring(oldV2, currentKeyring, "notion:bot-1:access"),
    ).toBe("old-v2-token");
    expect(
      decryptNotionTokenWithKeyring(legacy, currentKeyring, "notion:bot-1:access"),
    ).toBe("legacy-token");
    expect(notionTokenNeedsRotation(oldV2, currentKeyring)).toBe(true);
    expect(notionTokenNeedsRotation(legacy, currentKeyring)).toBe(true);
  });

  it("rejects unknown key ids instead of guessing for v2", () => {
    const sealed = encryptNotionTokenWithKeyring(
      "token",
      { currentId: "old", currentKey: oldKey },
      "context",
    );
    expect(() =>
      decryptNotionTokenWithKeyring(
        sealed,
        { currentId: "current", currentKey: key },
        "context",
      ),
    ).toThrow(/Unknown Notion token encryption key id/);
  });

  it("rejects invalid encryption key sizes", () => {
    expect(() => encryptNotionToken("token", "bad", "context")).toThrow(
      /32-byte/,
    );
    expect(() =>
      encryptNotionTokenWithKeyring(
        "token",
        { currentId: "current", currentKey: "bad" },
        "context",
      ),
    ).toThrow(/32-byte/);
  });

  it("signs state for one member and expires it", () => {
    const now = Date.UTC(2026, 7, 20, 8);
    const state = createNotionStateToken("member-1", "auth-secret", now);
    expect(
      verifyNotionStateToken(state, "member-1", "auth-secret", now + 1_000),
    ).toBe(true);
    expect(
      verifyNotionStateToken(state, "member-2", "auth-secret", now + 1_000),
    ).toBe(false);
    expect(
      verifyNotionStateToken(state, "member-1", "wrong-secret", now + 1_000),
    ).toBe(false);
    expect(
      verifyNotionStateToken(`${state.slice(0, -1)}x`, "member-1", "auth-secret", now),
    ).toBe(false);
    expect(
      verifyNotionStateToken(
        state,
        "member-1",
        "auth-secret",
        now + 10 * 60 * 1_000 + 1,
      ),
    ).toBe(false);
  });
});
