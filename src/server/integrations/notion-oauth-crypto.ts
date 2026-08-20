import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const TOKEN_FORMAT = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function encryptionKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("NOTION_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

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
    TOKEN_FORMAT,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptNotionToken(
  sealed: string,
  keyValue: string,
  context: string,
): string {
  const [version, ivValue, tagValue, ciphertextValue, ...extra] =
    sealed.split(".");
  if (
    version !== TOKEN_FORMAT ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    extra.length > 0
  ) {
    throw new Error("Unsupported encrypted Notion token format");
  }
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

interface OAuthStatePayload {
  memberId: string;
  expiresAt: number;
  nonce: string;
}

function signStatePayload(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
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
