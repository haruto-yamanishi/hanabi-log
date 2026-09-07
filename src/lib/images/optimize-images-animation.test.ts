import { afterEach, describe, expect, it, vi } from "vitest";
import { optimizeImages } from "@/lib/images/optimize-images";

function ascii(value: string): Uint8Array {
  return Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const header = new Uint8Array(8);
  new DataView(header.buffer).setUint32(0, data.length, false);
  header.set(ascii(type), 4);
  // CRC is irrelevant to the lightweight animation detector; the browser is
  // never asked to decode these fixtures because they must be rejected first.
  return concat(header, data, new Uint8Array(4));
}

function animatedPng(): File {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const actl = new Uint8Array(8);
  new DataView(actl.buffer).setUint32(0, 2, false);
  new DataView(actl.buffer).setUint32(4, 0, false);
  const bytes = concat(signature, pngChunk("acTL", actl), pngChunk("IDAT", new Uint8Array()));
  return new File([asArrayBuffer(bytes)], "animated.png", { type: "image/png" });
}

function animatedWebp(): File {
  const vp8xData = new Uint8Array(10);
  vp8xData[0] = 0x02; // WebP VP8X animation feature flag.
  const chunkHeader = new Uint8Array(8);
  chunkHeader.set(ascii("VP8X"), 0);
  new DataView(chunkHeader.buffer).setUint32(4, vp8xData.length, true);
  const payload = concat(ascii("WEBP"), chunkHeader, vp8xData);
  const riff = new Uint8Array(8);
  riff.set(ascii("RIFF"), 0);
  new DataView(riff.buffer).setUint32(4, payload.length, true);
  const bytes = concat(riff, payload);
  return new File([asArrayBuffer(bytes)], "animated.webp", { type: "image/webp" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("animated image protection", () => {
  it("rejects APNG before decoding so canvas re-encoding cannot silently drop frames", async () => {
    const createBitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", createBitmap);

    await expect(optimizeImages([animatedPng()])).rejects.toThrow("アニメーション画像");
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it("rejects Animated WebP before decoding so canvas re-encoding cannot silently drop frames", async () => {
    const createBitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", createBitmap);

    await expect(optimizeImages([animatedWebp()])).rejects.toThrow("アニメーション画像");
    expect(createBitmap).not.toHaveBeenCalled();
  });
});
