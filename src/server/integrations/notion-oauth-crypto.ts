import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const LEGACY_TOKEN_FORMAT = "v1";
const KEYRING_TOKEN_FORMAT = "v2";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

function encryptionKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("NOTION_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

function decryptPayload(
  ivValue: string,
  tagValue: string,
  ciphertextValue: string,
  keyValue: string,
  context: string,
): string {
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Invalid encrypted Notion token metadata");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(keyValue), iv);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Legacy v1 format retained for backward compatibility and migration tests. */
export function encryptNotionToken(
  plaintext: string,
  keyValue: string,
  context: string,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyValue), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    LEGACY_TOKEN_FORMAT,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Legacy v1 decryptor retained so existing ciphertext remains readable. */
export function decryptNotionToken(
  sealed: string,
  keyValue: string,
  context: string,
): string {
  const [version, ivValue, tagValue, ciphertextValue, ...extra] = sealed.split(".");
  if (
    version !== LEGACY_TOKEN_FORMAT ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    extra.length > 0
  ) {
    throw new Error("Unsupported encrypted Notion token format");
  }
  return decryptPayload(ivValue, tagValue, ciphertextValue, keyValue, context);
}

export interface NotionTokenKeyring {
  currentId: string;
  currentKey: string;
  decryptionKeys?: Record<string, string>;
}

function validateKeyring(keyring: NotionTokenKeyring): void {
  if (!KEY_ID_PATTERN.test(keyring.currentId)) {
    throw new Error("Invalid Notion token encryption key id");
  }
  encryptionKey(keyring.currentKey);
  for (const [id, key] of Object.entries(keyring.decryptionKeys ?? {})) {
    if (!KEY_ID_PATTERN.test(id)) throw new Error("Invalid Notion token decryption key id");
    encryptionKey(key);
  }
}

export function encryptNotionTokenWithKeyring(
  plaintext: string,
  keyring: NotionTokenKeyring,
  context: string,
): string {
  validateKeyring(keyring);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyring.currentKey), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    KEYRING_TOKEN_FORMAT,
    keyring.currentId,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptNotionTokenWithKeyring(
  sealed: string,
  keyring: NotionTokenKeyring,
  context: string,
): string {
  validateKeyring(keyring);
  const parts = sealed.split(".");

  if (parts[0] === KEYRING_TOKEN_FORMAT) {
    const [version, keyId, ivValue, tagValue, ciphertextValue, ...extra] = parts;
    if (
      version !== KEYRING_TOKEN_FORMAT ||
      !keyId ||
      !ivValue ||
      !tagValue ||
      !ciphertextValue ||
      extra.length > 0
    ) {
      throw new Error("Unsupported encrypted Notion token format");
    }
    const keyValue =
      keyId === keyring.currentId
        ? keyring.currentKey
        : keyring.decryptionKeys?.[keyId];
    if (!keyValue) throw new Error(`Unknown Notion token encryption key id: ${keyId}`);
    return decryptPayload(ivValue, tagValue, ciphertextValue, keyValue, context);
  }

  if (parts[0] === LEGACY_TOKEN_FORMAT) {
    const candidates = [
      keyring.currentKey,
      ...Object.values(keyring.decryptionKeys ?? {}),
    ];
    const uniqueCandidates = [...new Set(candidates)];
    for (const candidate of uniqueCandidates) {
      try {
        return decryptNotionToken(sealed, candidate, context);
      } catch {
        // Legacy v1 has no key id, so try every configured decryption key.
      }
    }
    throw new Error("Unable to decrypt legacy Notion token with configured keys");
  }

  throw new Error("Unsupported encrypted Notion token format");
}

export function notionTokenNeedsRotation(
  sealed: string,
  keyring: NotionTokenKeyring,
): boolean {
  const [version, keyId] = sealed.split(".");
  return version !== KEYRING_TOKEN_FORMAT || keyId !== keyring.currentId;
}

interface OAuthStatePayload {
  memberId: string;
  expiresAt: number;
  nonce: string;
}

function signStatePayload(payload: string, secret: string): Buffer {
  // AUTH_SECRET is a server-held HMAC signing key for OAuth state integrity,
  // not a user password or stored password verifier.
  return createHmac("sha256", secret).update(payload).digest(); // lgtm[js/insufficient-password-hash]
}

export function createNotionOAuthState(
  memberId: string,
  secret: string,
  now = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      memberId,
      expiresAt: now + 10 * 60 * 1_000,
      nonce: randomBytes(18).toString("base64url"),
    } satisfies OAuthStatePayload),
  ).toString("base64url");
  const signature = signStatePayload(payload, secret).toString("base64url");
  return `${payload}.${signature}`;
}

export function verifyNotionOAuthState(
  state: string,
  memberId: string,
  secret: string,
  now = Date.now(),
): boolean {
  const [payloadValue, signatureValue, ...extra] = state.split(".");
  if (!payloadValue || !signatureValue || extra.length > 0) return false;
  const actual = Buffer.from(signatureValue, "utf8");
  const expected = Buffer.from(
    signStatePayload(payloadValue, secret).toString("base64url"),
    "utf8",
  );
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return false;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(payloadValue, "base64url").toString("utf8"),
    ) as Partial<OAuthStatePayload>;
    return (
      payload.memberId === memberId &&
      typeof payload.expiresAt === "number" &&
      payload.expiresAt >= now &&
      typeof payload.nonce === "string" &&
      payload.nonce.length >= 16
    );
  } catch {
    return false;
  }
}
