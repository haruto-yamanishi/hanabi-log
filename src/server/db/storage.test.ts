import { expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("@/server/env", () => ({ isDemoMode: true, env: { APP_BASE_URL: "http://localhost:3000" } }));

import { acceptDemoUpload, createSignedUpload } from "@/server/db/storage";

it("stores videos larger than the previous 5 MiB image limit with their own extension", async () => {
  const bytes = new Uint8Array(6 * 1024 * 1024);
  const upload = await createSignedUpload({ id: "member-1" } as CurrentUser, {
    mimeType: "video/quicktime", sizeBytes: bytes.byteLength,
  }, "http://127.0.0.1:3000");
  expect(upload.signedUrl).toMatch(/^\/api\/uploads\?/);
  const requestUrl = new URL(upload.signedUrl, "http://127.0.0.1:3000");
  expect(upload.storagePath).toMatch(/\.mov$/);
  await expect(acceptDemoUpload(upload.token, new Request(requestUrl, {
    method: "PUT", headers: { "Content-Type": "video/quicktime" }, body: bytes,
  }))).resolves.toBeUndefined();
  await expect(acceptDemoUpload(upload.token, new Request(requestUrl, {
    method: "PUT", headers: { "Content-Type": "video/quicktime" }, body: bytes,
  }))).rejects.toMatchObject({ code: "UPLOAD_URL_EXPIRED" });
});
