import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { openPage } from "./navigation";

const MiB = 1024 * 1024;
type ImageFile = { name: string; mimeType: string; buffer: Buffer };
type UploadMetadata = { filename: string; mimeType: string; sizeBytes: number };
type FinalizeMetadata = UploadMetadata & { storagePath: string };
type UploadedBytes = { mimeType: string; bytes: Buffer };

test.setTimeout(150_000);
// Large fixtures are generated one at a time in each browser, without binary assets or dependencies.
test.describe.configure({ mode: "default" });

async function canvasFile(page: Page, kind: "photo" | "alpha" | "quadrants" | "noise"): Promise<ImageFile> {
  const result = await page.evaluate((fixtureKind) => {
    const canvas = document.createElement("canvas");
    // Keep fixture memory bounded on WebKit and mobile while still producing
    // files above the server's 5 MiB limit.
    canvas.width = fixtureKind === "quadrants" ? 120 : fixtureKind === "noise" ? 640 : fixtureKind === "alpha" ? 2400 : 2600;
    canvas.height = fixtureKind === "quadrants" ? 80 : fixtureKind === "noise" ? 480 : fixtureKind === "alpha" ? 1800 : 1900;
    const context = canvas.getContext("2d")!;
    if (fixtureKind === "quadrants") {
      ["#ff0000", "#0000ff", "#00ff00", "#ffffff"].forEach((color, index) => {
        context.fillStyle = color;
        context.fillRect((index % 2) * 60, Math.floor(index / 2) * 40, 60, 40);
      });
    } else {
      const pixels = context.createImageData(canvas.width, canvas.height);
      let random = 0x12345678;
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        random ^= random << 13;
        random ^= random >>> 17;
        random ^= random << 5;
        const gray = random & 255;
        pixels.data[offset] = gray;
        pixels.data[offset + 1] = fixtureKind === "alpha" ? gray : (random >>> 8) & 255;
        pixels.data[offset + 2] = fixtureKind === "alpha" ? gray : (random >>> 16) & 255;
        pixels.data[offset + 3] = fixtureKind === "alpha" && (offset / 4) % canvas.width < canvas.width / 8 ? 0 : 255;
      }
      context.putImageData(pixels, 0, 0);
    }
    const mimeType = fixtureKind === "alpha" ? "image/png" : "image/jpeg";
    const base64 = canvas.toDataURL(mimeType, 1).split(",")[1];
    canvas.width = canvas.height = 0;
    return { base64, mimeType };
  }, kind);
  return {
    name: `${kind}.${result.mimeType === "image/png" ? "png" : "jpg"}`,
    mimeType: result.mimeType,
    buffer: Buffer.from(result.base64, "base64"),
  };
}

async function captureUploads(page: Page) {
  const metadata: UploadMetadata[] = [];
  const finalizations: FinalizeMetadata[] = [];
  const uploads: UploadedBytes[] = [];
  await page.route("**/api/uploads*", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && pathname === "/api/uploads") {
      metadata.push(request.postDataJSON() as UploadMetadata);
    }
    if (request.method() === "POST" && pathname === "/api/uploads/finalize") {
      finalizations.push(request.postDataJSON() as FinalizeMetadata);
    }
    if (request.method() === "PUT") {
      uploads.push({ mimeType: request.headers()["content-type"], bytes: request.postDataBuffer()! });
    }
    await route.continue();
  });
  return { metadata, finalizations, uploads };
}

async function inspectImage(page: Page, upload: UploadedBytes) {
  return page.evaluate(async ({ base64, mimeType }) => {
    const image = new Image();
    image.src = `data:${mimeType};base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const samples = [[0.05, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].map(([x, y]) =>
      Array.from(context.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data),
    );
    const result = { width: canvas.width, height: canvas.height, samples };
    canvas.width = canvas.height = 0;
    return result;
  }, { base64: upload.bytes.toString("base64"), mimeType: upload.mimeType });
}

function assertUploadMatches(metadata: UploadMetadata, upload: UploadedBytes) {
  expect(upload.bytes.length).toBe(metadata.sizeBytes);
  expect(upload.mimeType).toBe(metadata.mimeType);
  expect(metadata.sizeBytes).toBeGreaterThan(0);
  expect(metadata.sizeBytes).toBeLessThanOrEqual(5 * MiB);
  const extension = metadata.filename.split(".").at(-1);
  if (metadata.mimeType === "image/jpeg") {
    expect(extension).toMatch(/^jpe?g$/);
    expect(upload.bytes.subarray(0, 2).toString("hex")).toBe("ffd8");
  } else if (metadata.mimeType === "image/png") {
    expect(extension).toBe("png");
    expect(upload.bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  } else {
    expect(metadata.mimeType).toBe("image/webp");
    expect(extension).toBe("webp");
    expect(upload.bytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(upload.bytes.subarray(8, 12).toString()).toBe("WEBP");
  }
}

async function fillReport(page: Page, title: string) {
  await page.getByLabel("タイトル任意").fill(title);
  await page.getByLabel("活動領域必須").selectOption({ label: "ロボット" });
  await page.getByLabel("内容カテゴリ必須").selectOption({ label: "進捗" });
  await page.getByLabel("今日やったこと必須").fill("ブラウザで画像を最適化して日報に添付した。");
}

test("大きいJPEGと透過PNGを最適化し、実データを保存して日報で表示できる", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "大きな実画像の経路はChromiumで検証する");
  await openPage(page, "/reports/new");
  const photo = await canvasFile(page, "photo");
  const alpha = await canvasFile(page, "alpha");
  const files = [photo, alpha];
  const originalTotal = files.reduce((sum, file) => sum + file.buffer.length, 0);
  expect(photo.buffer.length).toBeGreaterThan(5 * MiB);
  expect(alpha.buffer.length).toBeGreaterThan(5 * MiB);
  expect(originalTotal).toBeGreaterThan(10 * MiB);
  const originalHashes = files.map((file) => createHash("sha256").update(file.buffer).digest("hex"));
  const captured = await captureUploads(page);
  const title = `画像最適化 ${testInfo.project.name} ${crypto.randomUUID()}`;
  await fillReport(page, title);
  await page.evaluate(() => {
    let previous = performance.now();
    let maxDelayMs = 0;
    let samples = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      maxDelayMs = Math.max(maxDelayMs, now - previous - 50);
      previous = now;
      samples += 1;
    }, 50);
    (window as typeof window & { stopImageHeartbeat: () => { maxDelayMs: number; samples: number } }).stopImageHeartbeat = () => {
      clearInterval(timer);
      return { maxDelayMs, samples };
    };
  });
  const started = Date.now();
  await page.locator('input[type="file"]').setInputFiles(files);
  await expect(page.locator("#image-optimization-status")).toContainText("画像を最適化しました", { timeout: 90_000 });
  await expect(page.locator(".attachment-item")).toHaveCount(2, { timeout: 30_000 });
  const elapsedMs = Date.now() - started;
  const heartbeat = await page.evaluate(() => (window as typeof window & { stopImageHeartbeat: () => { maxDelayMs: number; samples: number } }).stopImageHeartbeat());
  expect(captured.metadata).toHaveLength(2);
  expect(captured.uploads).toHaveLength(2);
  expect(captured.finalizations).toHaveLength(2);
  const optimizedTotal = captured.metadata.reduce((sum, file) => sum + file.sizeBytes, 0);
  expect(optimizedTotal).toBeLessThanOrEqual(10 * MiB);
  expect(optimizedTotal).toBeLessThan(originalTotal);
  await expect(page.locator("#image-optimization-status")).toContainText(`${(originalTotal / MiB).toFixed(2)} MiB → ${(optimizedTotal / MiB).toFixed(2)} MiB`);
  for (const [index, upload] of captured.uploads.entries()) {
    assertUploadMatches(captured.metadata[index], upload);
    expect(captured.finalizations[index]).toMatchObject(captured.metadata[index]);
    const decoded = await inspectImage(page, upload);
    expect(Math.max(decoded.width, decoded.height)).toBeLessThanOrEqual(2560);
    expect(decoded.width / decoded.height).toBeCloseTo(index === 0 ? 2600 / 1900 : 4 / 3, 2);
    if (index === 1) {
      expect(["image/webp", "image/png"]).toContain(upload.mimeType);
      expect(decoded.samples[0][3]).toBe(0);
    }
    expect(createHash("sha256").update(files[index].buffer).digest("hex")).toBe(originalHashes[index]);
  }
  await page.getByLabel("画像の説明").nth(0).fill("最適化した写真");
  await page.getByLabel("画像の説明").nth(1).fill("透過を保持した図");
  const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(layout.content).toBeLessThanOrEqual(layout.viewport + 1);
  await testInfo.attach("optimized-image-form", {
    body: await page.locator('section[aria-labelledby="media-heading"]').screenshot(),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "下書き保存", exact: true }).click();
  await expect(page).toHaveURL(/\/reports\/[^/]+\/edit\?saved=1$/, { timeout: 90_000 });
  const reportId = new URL(page.url()).pathname.split("/").at(-2)!;
  const savedResponse = await page.request.get(`/api/reports/${reportId}`);
  expect(savedResponse.ok()).toBe(true);
  const saved = await savedResponse.json() as { attachments: UploadMetadata[] };
  expect(saved.attachments.map(({ filename, mimeType, sizeBytes }) => ({ filename, mimeType, sizeBytes }))).toEqual(captured.metadata);
  await page.getByRole("button", { name: "公開する", exact: true }).click();
  await expect(page).toHaveURL(/\/reports\/[^/?]+\?published=1$/, { timeout: 90_000 });
  for (const alt of ["最適化した写真", "透過を保持した図"]) {
    const image = page.getByRole("img", { name: alt, exact: true });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  }
  await testInfo.attach("image-optimization-metrics", {
    body: JSON.stringify({ browser: testInfo.project.name, originalTotal, optimizedTotal, elapsedMs, heartbeat, viewport: page.viewportSize() }, null, 2),
    contentType: "application/json",
  });
});

function addOrientationExif(file: ImageFile): ImageFile {
  const camera = Buffer.from("HANABI-E2E-CAMERA-METADATA\0", "ascii");
  const tiff = Buffer.alloc(38 + camera.length);
  tiff.write("II", 0);
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  tiff.writeUInt16LE(0x0112, 10); // Orientation: 90 degrees clockwise.
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(6, 18);
  tiff.writeUInt16LE(0x010f, 22); // Camera make (ASCII).
  tiff.writeUInt16LE(2, 24);
  tiff.writeUInt32LE(camera.length, 26);
  tiff.writeUInt32LE(38, 30);
  camera.copy(tiff, 38);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const marker = Buffer.alloc(4);
  marker.writeUInt16BE(0xffe1, 0);
  marker.writeUInt16BE(payload.length + 2, 2);
  return { ...file, name: "camera-orientation.jpg", buffer: Buffer.concat([file.buffer.subarray(0, 2), marker, payload, file.buffer.subarray(2)]) };
}

test("EXIFの向きを画素に反映し、メタデータを除去して小画像を拡大しない", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "webkit", "WebKitのsigned fetchはルート監視の対象外としてChromium/Mobileで検証する");
  await openPage(page, "/reports/new");
  const file = addOrientationExif(await canvasFile(page, "quadrants"));
  const captured = await captureUploads(page);
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.locator(".attachment-item")).toHaveCount(1, { timeout: 30_000 });
  expect(captured.uploads).toHaveLength(1);
  expect(captured.finalizations).toHaveLength(1);
  assertUploadMatches(captured.metadata[0], captured.uploads[0]);
  expect(captured.finalizations[0]).toMatchObject(captured.metadata[0]);
  expect(captured.metadata[0].filename).toBe("camera-orientation.jpg");
  expect(captured.uploads[0].bytes.includes(Buffer.from("Exif\0\0"))).toBe(false);
  expect(captured.uploads[0].bytes.includes(Buffer.from("HANABI-E2E-CAMERA-METADATA"))).toBe(false);
  const decoded = await inspectImage(page, captured.uploads[0]);
  expect([decoded.width, decoded.height]).toEqual([80, 120]);
  const expectedColors = [[0, 255, 0], [255, 0, 0], [255, 255, 255], [0, 0, 255]];
  expectedColors.forEach((color, index) => {
    color.forEach((channel, channelIndex) => expect(Math.abs(decoded.samples[index + 1][channelIndex] - channel)).toBeLessThan(15));
  });
});

test("画像の読み込み・再エンコードに失敗しても原本を送らず、再選択で復帰できる", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "webkit", "WebKitのsigned fetchはルート監視の対象外としてChromium/Mobileで検証する");
  await openPage(page, "/reports/new");
  const captured = await captureUploads(page);
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({ name: "broken.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not an image") });
  await expect(page.locator("#attachments-error")).toBeVisible();
  expect(captured.metadata).toHaveLength(0);
  expect(captured.uploads).toHaveLength(0);
  expect(captured.finalizations).toHaveLength(0);

  const valid = await canvasFile(page, "quadrants");
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    (window as typeof window & { restoreEncoder: () => void }).restoreEncoder = () => { HTMLCanvasElement.prototype.toBlob = original; };
    HTMLCanvasElement.prototype.toBlob = function (callback) { queueMicrotask(() => callback(null)); };
  });
  await input.setInputFiles(valid);
  await expect(page.locator("#attachments-error")).toBeVisible();
  await expect(input).toBeEnabled();
  expect(captured.metadata).toHaveLength(0);
  expect(captured.uploads).toHaveLength(0);
  expect(captured.finalizations).toHaveLength(0);
  await page.evaluate(() => (window as typeof window & { restoreEncoder: () => void }).restoreEncoder());
  await input.setInputFiles(valid);
  await expect(page.locator(".attachment-item")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator("#attachments-error")).toHaveCount(0);
  expect(captured.uploads).toHaveLength(1);
  expect(captured.finalizations).toHaveLength(1);
});

test("既存画像を保持し、処理中の保存・二重選択を防いで入力を維持する", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "webkit", "WebKitのsigned fetchはルート監視の対象外としてChromium/Mobileで検証する");
  await openPage(page, "/reports/new");
  const existing = await canvasFile(page, "quadrants");
  await fillReport(page, "処理中の操作ロック");
  const createInput = page.locator('input[type="file"]');
  await createInput.setInputFiles(existing);
  await expect(page.locator(".attachment-item")).toHaveCount(1, { timeout: 30_000 });
  await page.getByLabel("画像の説明").fill("既存の説明");
  await page.getByRole("button", { name: "下書き保存", exact: true }).click();
  await expect(page).toHaveURL(/\/reports\/[^/]+\/edit\?saved=1$/, { timeout: 90_000 });
  const reportId = new URL(page.url()).pathname.split("/").at(-2)!;

  await openPage(page, `/reports/${reportId}/edit`);
  await expect(page.locator(".attachment-item")).toHaveCount(1);
  const noise = await canvasFile(page, "noise");
  const captured = await captureUploads(page);
  const input = page.locator('input[type="file"]');

  await page.evaluate(() => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    (window as typeof window & { releaseEncoding: () => void }).releaseEncoding = release;
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      original.call(this, (blob) => { void gate.then(() => callback(blob)); }, type, quality);
    };
  });

  let saveRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === `/api/reports/${reportId}` && request.method() === "PATCH") saveRequests += 1;
  });

  await input.setInputFiles(noise);
  await expect(page.locator("#image-optimization-status")).toContainText("画像を最適化しています…");
  await expect(page.locator("#image-optimization-status")).toHaveAttribute("aria-live", "polite");
  await expect(input).toBeDisabled();
  await expect(page.getByRole("button", { name: "下書き保存", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "公開する", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "quadrants.jpgを削除", exact: true })).toBeDisabled();

  await page.getByLabel("タイトル任意").fill("最適化中に編集したタイトル");
  await page.getByLabel("画像の説明").first().fill("最適化中に編集した既存画像の説明");

  await page.evaluate(() => {
    document.querySelector("form.report-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["invalid duplicate selection"], "duplicate.jpg", { type: "image/jpeg" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(saveRequests).toBe(0);
  expect(captured.metadata).toHaveLength(0);
  expect(captured.uploads).toHaveLength(0);
  expect(captured.finalizations).toHaveLength(0);

  await page.evaluate(() => (window as typeof window & { releaseEncoding: () => void }).releaseEncoding());
  await expect(page.locator(".attachment-item")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "quadrants.jpgを削除", exact: true })).toBeVisible();
  expect(captured.metadata).toHaveLength(1);
  expect(captured.uploads).toHaveLength(1);
  expect(captured.finalizations).toHaveLength(1);
  assertUploadMatches(captured.metadata[0], captured.uploads[0]);
  expect(captured.finalizations[0]).toMatchObject(captured.metadata[0]);
  expect(captured.metadata[0].sizeBytes).toBeLessThanOrEqual(5 * MiB);
  await expect(page.getByLabel("タイトル任意")).toHaveValue("最適化中に編集したタイトル");
  await expect(page.getByLabel("画像の説明").first()).toHaveValue("最適化中に編集した既存画像の説明");

  await page.getByRole("button", { name: "下書き保存", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${reportId}/edit\\?saved=1$`), { timeout: 90_000 });
  expect(saveRequests).toBe(1);
});
