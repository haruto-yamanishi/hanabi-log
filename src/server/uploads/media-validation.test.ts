import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let validateMediaBytes: typeof import("./media-validation").validateMediaBytes;
let assertMediaNameMatchesMime: typeof import("./media-validation").assertMediaNameMatchesMime;

beforeAll(async () => {
  ({ validateMediaBytes, assertMediaNameMatchesMime } = await import("./media-validation"));
});

function fixture(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const JPEG_1X1 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z";
const WEBP_1X1 = "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=";

describe("uploaded media validation", () => {
  it("accepts structurally valid JPEG, PNG, and WebP images", () => {
    expect(validateMediaBytes(fixture(JPEG_1X1), "image/jpeg")).toMatchObject({ width: 1, height: 1 });
    expect(validateMediaBytes(fixture(PNG_1X1), "image/png")).toMatchObject({ width: 1, height: 1 });
    expect(validateMediaBytes(fixture(WEBP_1X1), "image/webp")).toMatchObject({ width: 1, height: 1 });
  });

  it("rejects a corrupted PNG even when the signature still says PNG", () => {
    const bytes = fixture(PNG_1X1);
    bytes[bytes.length - 10] ^= 0xff;
    expect(() => validateMediaBytes(bytes, "image/png")).toThrow(/PNG/);
  });

  it("rejects a truncated JPEG", () => {
    const bytes = fixture(JPEG_1X1).slice(0, -1);
    expect(() => validateMediaBytes(bytes, "image/jpeg")).toThrow(/JPEG/);
  });

  it("rejects a malformed WebP RIFF length", () => {
    const bytes = fixture(WEBP_1X1);
    bytes[4] = 0;
    expect(() => validateMediaBytes(bytes, "image/webp")).toThrow(/WebP/);
  });

  it("rejects MIME spoofing", () => {
    expect(() => validateMediaBytes(fixture(PNG_1X1), "image/jpeg")).toThrow(/MIME type/);
  });

  it("requires filename and Storage extensions to match the MIME type", () => {
    expect(() => assertMediaNameMatchesMime("photo.jpg", "member/2026-09/id.jpg", "image/jpeg")).not.toThrow();
    expect(() => assertMediaNameMatchesMime("photo.png", "member/2026-09/id.jpg", "image/jpeg")).toThrow(/拡張子/);
    expect(() => assertMediaNameMatchesMime("photo.jpg", "member/2026-09/id.png", "image/jpeg")).toThrow(/Storage path/);
  });
});
