import { afterEach, describe, expect, it, vi } from "vitest";
import { optimizeImages } from "@/lib/images/optimize-images";

const MiB = 1024 * 1024;

function inputFile(name = "photo.jpg", type = "image/jpeg", size = 2 * MiB) {
  return new File([new Uint8Array(size)], name, { type, lastModified: 1234 });
}

type Encoding = {
  filename: string;
  width: number;
  height: number;
  type: string;
  quality: number;
};

function browserHarness(options: {
  width?: number;
  height?: number;
  encode?: (encoding: Encoding) => Blob | null;
  noContext?: boolean;
  drawError?: boolean;
} = {}) {
  const encodings: Encoding[] = [];
  const bitmaps: { file: File; width: number; height: number; close: ReturnType<typeof vi.fn> }[] = [];
  let activeDecodes = 0;
  let peakDecodes = 0;
  const createBitmap = vi.fn(async (file: File) => {
    activeDecodes += 1;
    peakDecodes = Math.max(peakDecodes, activeDecodes);
    const bitmap = {
      file,
      width: options.width ?? 4032,
      height: options.height ?? 3024,
      close: vi.fn(() => { activeDecodes -= 1; }),
    };
    bitmaps.push(bitmap);
    return bitmap;
  });
  const canvases: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toBlob: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("createImageBitmap", createBitmap);
  vi.stubGlobal("document", {
    createElement: vi.fn((tag: string) => {
      expect(tag).toBe("canvas");
      let filename = "fallback";
      const context = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        drawImage: vi.fn((source: { file?: File }) => {
          if (options.drawError) throw new Error("draw failed");
          filename = source.file?.name ?? "fallback";
        }),
      };
      const canvas = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => options.noContext ? null : context),
        toBlob: vi.fn((callback: BlobCallback, type: string, quality: number) => {
          const encoding = { filename, width: canvas.width, height: canvas.height, type, quality };
          encodings.push(encoding);
          const blob = options.encode ? options.encode(encoding) : new Blob(["encoded pixels"], { type });
          queueMicrotask(() => callback(blob));
        }),
      };
      canvases.push(canvas);
      return canvas;
    }),
  });
  return { encodings, bitmaps, canvases, createBitmap, peakDecodes: () => peakDecodes };
}

function imageElementFallback(mode: "load" | "error" | "pending" = "load") {
  const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-image");
  const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const instances: FakeImage[] = [];
  class FakeImage {
    naturalWidth = 600;
    naturalHeight = 800;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    currentSource = "";
    constructor() { instances.push(this); }
    set src(value: string) {
      this.currentSource = value;
      if (value) queueMicrotask(() => {
        if (mode === "load") this.onload?.();
        if (mode === "error") this.onerror?.();
      });
    }
  }
  vi.stubGlobal("Image", FakeImage);
  return { createObjectURL, revokeObjectURL, instances };
}

function blobOfSize(size: number, type = "image/jpeg") {
  return new Blob([new Uint8Array(size)], { type });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("optimizeImages", () => {
  it("re-encodes a small image once without enlarging it or changing the original", async () => {
    const browser = browserHarness({ width: 800, height: 600 });
    const original = inputFile("trip.JPEG");
    const originalBytes = await original.arrayBuffer();
    const [result] = await optimizeImages([original]);

    expect(browser.encodings).toEqual([{ filename: "trip.JPEG", width: 800, height: 600, type: "image/jpeg", quality: 0.82 }]);
    expect(result).toMatchObject({ originalSize: 2 * MiB, originalMimeType: "image/jpeg", optimizedMimeType: "image/jpeg", width: 800, height: 600 });
    expect(result.file).not.toBe(original);
    expect(result.file.name).toBe("trip.JPEG");
    expect(result.file.lastModified).toBe(1234);
    expect(await original.arrayBuffer()).toEqual(originalBytes);
    expect(original.name).toBe("trip.JPEG");
    expect(original.type).toBe("image/jpeg");
    expect(original.size).toBe(2 * MiB);
    expect(result.optimizedSize).toBe(result.file.size);
  });

  it("resizes a large image proportionally and continues until the per-file limit is met", async () => {
    const browser = browserHarness({ encode: ({ quality }) => blobOfSize(quality === 0.82 ? 6 * MiB : 5 * MiB) });
    const original = inputFile("large.jpg", "image/jpeg", 8 * MiB);
    const [result] = await optimizeImages([original]);

    expect(result.file.size).toBe(5 * MiB);
    expect(result.width).toBe(2560);
    expect(result.height).toBe(1920);
    expect(browser.encodings.map(({ quality }) => quality)).toEqual([0.82, 0.75]);
    expect(browser.createBitmap).toHaveBeenNthCalledWith(1, original, { imageOrientation: "from-image" });
    expect(browser.createBitmap).toHaveBeenNthCalledWith(2, original, { imageOrientation: "from-image" });
  });

  it("applies extra compression fairly to all images until their combined size fits", async () => {
    const browser = browserHarness({ encode: ({ quality }) => blobOfSize(quality === 0.82 ? 4 * MiB : 3 * MiB) });
    const originals = ["a.jpg", "b.jpg", "c.jpg"].map((name) => inputFile(name, "image/jpeg", 4 * MiB));
    const results = await optimizeImages(originals);

    expect(results.reduce((sum, image) => sum + image.file.size, 0)).toBe(9 * MiB);
    expect(browser.encodings.map(({ filename, quality }) => [filename, quality])).toEqual([
      ["a.jpg", 0.82], ["b.jpg", 0.82], ["c.jpg", 0.82],
      ["a.jpg", 0.75], ["b.jpg", 0.75], ["c.jpg", 0.75],
    ]);
    expect(browser.peakDecodes()).toBe(1);
    expect(browser.bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);
    expect(browser.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });

  it("uses the remaining report budget rather than the default total limit", async () => {
    browserHarness({ encode: ({ quality }) => blobOfSize(quality > 0.68 ? 2 * MiB : MiB) });
    const results = await optimizeImages([inputFile("a.jpg"), inputFile("b.jpg")], { maxTotalBytes: 2 * MiB });
    expect(results.reduce((sum, image) => sum + image.file.size, 0)).toBe(2 * MiB);
  });

  it("honors a tighter per-file budget even when the total already fits", async () => {
    browserHarness({ encode: ({ quality }) => blobOfSize(quality === 0.82 ? 2 * MiB : MiB) });
    const [result] = await optimizeImages([inputFile()], { maxFileBytes: MiB });
    expect(result.file.size).toBe(MiB);
  });

  it("rejects an impossible total after bounded passes down to the minimum dimension", async () => {
    const browser = browserHarness({ encode: () => blobOfSize(4 * MiB) });
    await expect(optimizeImages([inputFile("a.jpg"), inputFile("b.jpg"), inputFile("c.jpg")])).rejects.toThrow("画像の枚数を減らすか");

    expect(browser.encodings).toHaveLength(18);
    expect(browser.encodings.filter(({ filename }) => filename === "a.jpg").map(({ width, height, quality }) => [width, height, quality])).toEqual([
      [2560, 1920, 0.82], [2560, 1920, 0.75], [2560, 1920, 0.68],
      [2560, 1920, 0.62], [2048, 1536, 0.62], [1600, 1200, 0.62],
    ]);
    expect(browser.bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);
  });

  it("reduces dimensions when lowering quality is insufficient", async () => {
    const browser = browserHarness({ encode: ({ width }) => blobOfSize(width > 2048 ? 6 * MiB : 4 * MiB) });
    const [result] = await optimizeImages([inputFile()]);
    expect(result).toMatchObject({ width: 2048, height: 1536, optimizedSize: 4 * MiB });
    expect(browser.encodings).toHaveLength(5);
  });

  it("keeps a smaller previous re-encoding if a later encoder result unexpectedly grows", async () => {
    browserHarness({
      encode: ({ filename, quality }) => blobOfSize(filename === "a.jpg" ? (quality === 0.82 ? 2 : 3) * MiB : (quality === 0.82 ? 5 : 3) * MiB),
    });
    const results = await optimizeImages([inputFile("a.jpg"), inputFile("b.jpg")], { maxTotalBytes: 5 * MiB });
    expect(results.map((image) => image.file.size)).toEqual([2 * MiB, 3 * MiB]);
  });

  it("always returns newly encoded pixels, even when a tiny original would be smaller", async () => {
    browserHarness();
    const original = inputFile("tiny.jpg", "image/jpeg", 1);
    const [result] = await optimizeImages([original]);
    expect(result.file).not.toBe(original);
    expect(result.file.size).toBeGreaterThan(original.size);
  });

  it.each([
    ["diagram.png", "image/png", "diagram.webp"],
    ["photo.wrong", "image/webp", "photo.webp"],
    ["photo.png", "image/jpeg", "photo.jpg"],
    ["photo", "image/jpeg", "photo.jpg"],
    ["jpg", "image/jpeg", "jpg.jpg"],
    ["jpeg", "image/jpeg", "jpeg.jpg"],
    ["webp", "image/webp", "webp.webp"],
  ])("uses a matching MIME type and extension for %s", async (name, type, expectedName) => {
    const browser = browserHarness();
    const [result] = await optimizeImages([inputFile(name, type)]);
    const expectedMime = type === "image/jpeg" ? "image/jpeg" : "image/webp";
    expect(browser.encodings[0].type).toBe(expectedMime);
    expect(result.file.name).toBe(expectedName);
    expect(result.file.type).toBe(expectedMime);
    expect(result.optimizedMimeType).toBe(expectedMime);
  });

  it("keeps a renamed PNG within the API filename limit without splitting Unicode characters", async () => {
    browserHarness();
    const original = inputFile(`${"a".repeat(249)}📸.png`, "image/png");
    expect(original.name.length).toBe(255);
    const [result] = await optimizeImages([original]);
    expect(result.file.name).toBe(`${"a".repeat(249)}.webp`);
    expect(result.file.name.length).toBeLessThanOrEqual(255);
    expect(original.name).toBe(`${"a".repeat(249)}📸.png`);
  });

  it("accepts Safari's PNG encoder fallback and preserves its actual format", async () => {
    const browser = browserHarness({ encode: () => blobOfSize(100, "image/png") });
    const [result] = await optimizeImages([inputFile("alpha.webp", "image/webp")]);
    expect(browser.encodings[0].type).toBe("image/webp");
    expect(result.file.name).toBe("alpha.png");
    expect(result.file.type).toBe("image/png");
    expect(result.originalMimeType).toBe("image/webp");
  });

  it.each([null, new Blob([], { type: "image/jpeg" }), new Blob(["bad"], { type: "image/gif" })])("rejects invalid encoder output and releases resources", async (output) => {
    const browser = browserHarness({ encode: () => output });
    await expect(optimizeImages([inputFile()])).rejects.toThrow("最適化できませんでした");
    expect(browser.bitmaps[0].close).toHaveBeenCalledOnce();
    expect(browser.canvases[0]).toMatchObject({ width: 0, height: 0 });
  });

  it.each([{ noContext: true }, { drawError: true }, { width: 0 }])("releases a decoded image after canvas or dimension failures: %j", async (options) => {
    const browser = browserHarness(options);
    await expect(optimizeImages([inputFile()])).rejects.toThrow();
    expect(browser.bitmaps[0].close).toHaveBeenCalledOnce();
    expect(browser.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });

  it.each(["image/gif", "image/heic", "image/svg+xml", ""])("rejects unsupported MIME %s before any decoding", async (type) => {
    const browser = browserHarness();
    await expect(optimizeImages([inputFile("file", type)])).rejects.toThrow("JPEG・PNG・WebP");
    expect(browser.createBitmap).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN])("rejects an unusable remaining budget of %s without decoding", async (maxTotalBytes) => {
    const browser = browserHarness();
    await expect(optimizeImages([inputFile()], { maxTotalBytes })).rejects.toThrow("容量上限");
    expect(browser.createBitmap).not.toHaveBeenCalled();
  });

  it("does not let option overrides exceed server limits", async () => {
    const browser = browserHarness({ encode: () => blobOfSize(6 * MiB) });
    await expect(optimizeImages([inputFile()], { maxFileBytes: 10 * MiB, maxTotalBytes: 20 * MiB })).rejects.toThrow("容量上限");
    expect(browser.encodings).toHaveLength(6);
  });

  it("returns an empty selection without allocating browser resources", async () => {
    const browser = browserHarness();
    expect(await optimizeImages([], { maxTotalBytes: 0 })).toEqual([]);
    expect(browser.createBitmap).not.toHaveBeenCalled();
  });

  it("uses HTMLImageElement when ImageBitmap decoding fails and revokes the URL", async () => {
    const browser = browserHarness();
    browser.createBitmap.mockRejectedValue(new Error("unsupported bitmap options"));
    const fallback = imageElementFallback();
    const [result] = await optimizeImages([inputFile()]);
    expect(result).toMatchObject({ width: 600, height: 800 });
    expect(fallback.createObjectURL).toHaveBeenCalledOnce();
    expect(fallback.revokeObjectURL).toHaveBeenCalledWith("blob:test-image");
    expect(fallback.instances[0].currentSource).toBe("");
    expect(fallback.instances[0].onload).toBeNull();
    expect(fallback.instances[0].onerror).toBeNull();
  });

  it("releases a fallback URL after a corrupt image fails to load", async () => {
    browserHarness();
    vi.stubGlobal("createImageBitmap", undefined);
    const fallback = imageElementFallback("error");
    await expect(optimizeImages([inputFile()])).rejects.toThrow("読み込めませんでした");
    expect(fallback.revokeObjectURL).toHaveBeenCalledOnce();
    expect(fallback.instances[0].currentSource).toBe("");
  });

  it("does not decode anything when already aborted", async () => {
    const browser = browserHarness();
    const controller = new AbortController();
    controller.abort();
    await expect(optimizeImages([inputFile()], { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(browser.createBitmap).not.toHaveBeenCalled();
  });

  it("stops after the active encoder and releases its resources when cancelled", async () => {
    const controller = new AbortController();
    const browser = browserHarness({ encode: () => {
      controller.abort();
      return blobOfSize(100);
    } });
    await expect(optimizeImages([inputFile("a.jpg"), inputFile("b.jpg")], { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(browser.createBitmap).toHaveBeenCalledOnce();
    expect(browser.bitmaps[0].close).toHaveBeenCalledOnce();
    expect(browser.canvases[0]).toMatchObject({ width: 0, height: 0 });
  });

  it("releases a fallback image and URL when cancellation interrupts loading", async () => {
    browserHarness();
    vi.stubGlobal("createImageBitmap", undefined);
    const fallback = imageElementFallback("pending");
    const controller = new AbortController();
    const pending = optimizeImages([inputFile()], { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fallback.createObjectURL).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect(fallback.revokeObjectURL).toHaveBeenCalledOnce();
    expect(fallback.instances[0].currentSource).toBe("");
    expect(fallback.instances[0].onload).toBeNull();
    expect(fallback.instances[0].onerror).toBeNull();
  });
});
