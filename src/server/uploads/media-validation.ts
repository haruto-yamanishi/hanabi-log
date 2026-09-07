import "server-only";

import { inflateSync } from "node:zlib";
import {
  isImageMimeType,
  isVideoMimeType,
  type MediaMimeType,
} from "@/lib/media";
import { AppError } from "@/server/errors";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const MAX_IMAGE_PIXELS = 25_000_000;

export interface VerifiedMediaShape {
  mimeType: MediaMimeType;
  width?: number;
  height?: number;
}

function invalid(message: string): never {
  throw new AppError("INVALID_UPLOAD_CONTENT", message, 422);
}

function bytesEqual(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (offset < 0 || offset + expected.length > bytes.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > bytes.length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) invalid("画像データが途中で切れています");
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) invalid("画像データが途中で切れています");
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  if (offset + 3 > bytes.length) invalid("画像データが途中で切れています");
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) invalid("ファイルデータが途中で切れています");
  return (
    bytes[offset] * 0x1000000
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]
  ) >>> 0;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) invalid("ファイルデータが途中で切れています");
  return (
    bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] * 0x1000000)
  ) >>> 0;
}

function assertImageDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    invalid("画像の縦横サイズを確認できませんでした");
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    invalid("画像の解像度が大きすぎます。25MP以内にしてください");
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngBitsPerPixel(bitDepth: number, colorType: number): number {
  const channels = colorType === 0 ? 1
    : colorType === 2 ? 3
      : colorType === 3 ? 1
        : colorType === 4 ? 2
          : colorType === 6 ? 4
            : 0;
  if (!channels) invalid("PNGの色形式が不正です");

  const allowedDepths: Record<number, readonly number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (!allowedDepths[colorType]?.includes(bitDepth)) {
    invalid("PNGのビット深度が色形式と一致しません");
  }
  return channels * bitDepth;
}

function passDimension(size: number, start: number, step: number): number {
  return size <= start ? 0 : Math.ceil((size - start) / step);
}

function pngPasses(width: number, height: number, interlace: number): Array<{ width: number; height: number }> {
  if (interlace === 0) return [{ width, height }];
  if (interlace !== 1) invalid("PNGのインターレース方式が不正です");
  const adam7 = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ] as const;
  return adam7.map(([x, y, dx, dy]) => ({
    width: passDimension(width, x, dx),
    height: passDimension(height, y, dy),
  }));
}

function validatePng(bytes: Uint8Array): VerifiedMediaShape {
  if (!bytesEqual(bytes, 0, PNG_SIGNATURE)) invalid("PNGシグネチャが不正です");

  let position: number = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  let sawIhdr = false;
  let sawPlte = false;
  let sawIdat = false;
  let idatEnded = false;
  let sawIend = false;
  const idatChunks: Uint8Array[] = [];

  while (position < bytes.length) {
    if (position + 12 > bytes.length) invalid("PNGチャンクが途中で切れています");
    const length = readU32BE(bytes, position);
    const type = ascii(bytes, position + 4, 4);
    const dataStart = position + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    const next = crcOffset + 4;
    if (dataEnd < dataStart || next > bytes.length) invalid("PNGチャンク長が不正です");

    const expectedCrc = readU32BE(bytes, crcOffset);
    const actualCrc = crc32(bytes.subarray(position + 4, dataEnd));
    if (actualCrc !== expectedCrc) invalid("PNGの整合性チェックに失敗しました");

    if (!sawIhdr && type !== "IHDR") invalid("PNGの先頭チャンクがIHDRではありません");
    if (sawIdat && type !== "IDAT" && type !== "IEND") idatEnded = true;
    if (type === "IDAT" && idatEnded) invalid("PNGのIDATチャンク順序が不正です");

    if (type === "IHDR") {
      if (sawIhdr || length !== 13) invalid("PNGのIHDRが不正です");
      sawIhdr = true;
      width = readU32BE(bytes, dataStart);
      height = readU32BE(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      if (bytes[dataStart + 10] !== 0 || bytes[dataStart + 11] !== 0) {
        invalid("PNGの圧縮・フィルタ方式が不正です");
      }
      interlace = bytes[dataStart + 12];
      assertImageDimensions(width, height);
      pngBitsPerPixel(bitDepth, colorType);
      if (interlace !== 0 && interlace !== 1) invalid("PNGのインターレース方式が不正です");
    } else if (type === "PLTE") {
      if (!sawIhdr || sawIdat || length === 0 || length % 3 !== 0 || length > 768) {
        invalid("PNGのパレットが不正です");
      }
      sawPlte = true;
    } else if (type === "IDAT") {
      if (!sawIhdr || length === 0) invalid("PNGのIDATが不正です");
      sawIdat = true;
      idatChunks.push(bytes.slice(dataStart, dataEnd));
    } else if (type === "IEND") {
      if (!sawIhdr || !sawIdat || length !== 0) invalid("PNGのIENDが不正です");
      sawIend = true;
      position = next;
      break;
    } else if (type && type[0] === type[0]?.toUpperCase()) {
      invalid(`未対応のPNG必須チャンク（${type}）が含まれています`);
    }

    position = next;
  }

  if (!sawIhdr || !sawIdat || !sawIend || position !== bytes.length) {
    invalid("PNGが完全な画像データではありません");
  }
  if (colorType === 3 && !sawPlte) invalid("インデックスカラーPNGにパレットがありません");

  const bitsPerPixel = pngBitsPerPixel(bitDepth, colorType);
  const passes = pngPasses(width, height, interlace);
  const expectedInflated = passes.reduce((total, pass) => {
    if (!pass.width || !pass.height) return total;
    return total + (Math.ceil((pass.width * bitsPerPixel) / 8) + 1) * pass.height;
  }, 0);

  let inflated: Uint8Array;
  try {
    const compressed = Buffer.concat(idatChunks.map((chunk) => Buffer.from(chunk)));
    inflated = inflateSync(compressed, { maxOutputLength: expectedInflated });
  } catch {
    invalid("PNGの画像データを展開できませんでした");
  }
  if (inflated.byteLength !== expectedInflated) invalid("PNGの展開後サイズが不正です");

  let rowOffset = 0;
  for (const pass of passes) {
    if (!pass.width || !pass.height) continue;
    const rowBytes = Math.ceil((pass.width * bitsPerPixel) / 8);
    for (let row = 0; row < pass.height; row += 1) {
      const filter = inflated[rowOffset];
      if (filter > 4) invalid("PNGのフィルタ方式が不正です");
      rowOffset += rowBytes + 1;
    }
  }
  if (rowOffset !== inflated.byteLength) invalid("PNGの走査線データが不正です");

  return { mimeType: "image/png", width, height };
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function validateJpeg(bytes: Uint8Array): VerifiedMediaShape {
  if (!bytesEqual(bytes, 0, [0xff, 0xd8])) invalid("JPEGシグネチャが不正です");
  let position = 2;
  let width = 0;
  let height = 0;
  let sawSos = false;
  let sawEoi = false;

  while (position < bytes.length) {
    if (bytes[position] !== 0xff) invalid("JPEGマーカー構造が不正です");
    while (position < bytes.length && bytes[position] === 0xff) position += 1;
    if (position >= bytes.length) invalid("JPEGが途中で切れています");
    const marker = bytes[position];
    position += 1;

    if (marker === 0x00) invalid("JPEGマーカーが不正です");
    if (marker === 0xd9) {
      sawEoi = true;
      break;
    }
    if (marker === 0xd8) invalid("JPEGのSOIが重複しています");
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    if (position + 2 > bytes.length) invalid("JPEGセグメントが途中で切れています");
    const segmentLength = readU16BE(bytes, position);
    if (segmentLength < 2) invalid("JPEGセグメント長が不正です");
    const dataStart = position + 2;
    const segmentEnd = position + segmentLength;
    if (segmentEnd > bytes.length) invalid("JPEGセグメントが途中で切れています");

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 8) invalid("JPEGのフレーム情報が不正です");
      height = readU16BE(bytes, dataStart + 1);
      width = readU16BE(bytes, dataStart + 3);
      const components = bytes[dataStart + 5];
      if (!components || segmentLength < 8 + 3 * components) invalid("JPEGの色成分情報が不正です");
      assertImageDimensions(width, height);
    }

    position = segmentEnd;
    if (marker !== 0xda) continue;

    sawSos = true;
    while (position < bytes.length - 1) {
      if (bytes[position] !== 0xff) {
        position += 1;
        continue;
      }
      const next = bytes[position + 1];
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        position += 2;
        continue;
      }
      break;
    }
  }

  if (!sawSos || !sawEoi || !width || !height || position !== bytes.length) {
    invalid("JPEGを完全な画像として解析できませんでした");
  }
  return { mimeType: "image/jpeg", width, height };
}

function validateWebp(bytes: Uint8Array): VerifiedMediaShape {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    invalid("WebPシグネチャが不正です");
  }
  if (readU32LE(bytes, 4) + 8 !== bytes.length) invalid("WebPのRIFFサイズが不正です");

  let position = 12;
  let width = 0;
  let height = 0;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let sawImagePayload = false;

  while (position < bytes.length) {
    if (position + 8 > bytes.length) invalid("WebPチャンクが途中で切れています");
    const type = ascii(bytes, position, 4);
    const length = readU32LE(bytes, position + 4);
    const dataStart = position + 8;
    const dataEnd = dataStart + length;
    const next = dataEnd + (length % 2);
    if (dataEnd < dataStart || next > bytes.length) invalid("WebPチャンク長が不正です");

    if (type === "VP8X") {
      if (length < 10) invalid("WebPのVP8Xヘッダーが不正です");
      const flags = bytes[dataStart];
      if (flags & 0x02) invalid("Animated WebPは現在アップロードできません");
      canvasWidth = 1 + readU24LE(bytes, dataStart + 4);
      canvasHeight = 1 + readU24LE(bytes, dataStart + 7);
      assertImageDimensions(canvasWidth, canvasHeight);
    } else if (type === "VP8 ") {
      if (length < 10) invalid("WebPのVP8データが短すぎます");
      if (bytes[dataStart] & 0x01) invalid("WebPの先頭フレームがキーフレームではありません");
      if (!bytesEqual(bytes, dataStart + 3, [0x9d, 0x01, 0x2a])) invalid("WebPのVP8フレームヘッダーが不正です");
      width = readU16LE(bytes, dataStart + 6) & 0x3fff;
      height = readU16LE(bytes, dataStart + 8) & 0x3fff;
      assertImageDimensions(width, height);
      sawImagePayload = true;
    } else if (type === "VP8L") {
      if (length < 5 || bytes[dataStart] !== 0x2f) invalid("WebPのVP8Lヘッダーが不正です");
      const dimensions = readU32LE(bytes, dataStart + 1);
      width = 1 + (dimensions & 0x3fff);
      height = 1 + ((dimensions >>> 14) & 0x3fff);
      assertImageDimensions(width, height);
      sawImagePayload = true;
    } else if (type === "ANIM" || type === "ANMF") {
      invalid("Animated WebPは現在アップロードできません");
    }

    position = next;
  }

  if (position !== bytes.length || !sawImagePayload) invalid("WebPの画像データを確認できませんでした");
  if (canvasWidth && (canvasWidth !== width || canvasHeight !== height)) {
    invalid("WebPのキャンバスサイズと画像サイズが一致しません");
  }
  return { mimeType: "image/webp", width, height };
}

function validateMp4(bytes: Uint8Array): VerifiedMediaShape {
  if (bytes.length < 16 || ascii(bytes, 4, 4) !== "ftyp") invalid("MP4のftypヘッダーを確認できませんでした");
  const firstBoxSize = readU32BE(bytes, 0);
  if (firstBoxSize !== 1 && (firstBoxSize < 16 || firstBoxSize > bytes.length)) {
    invalid("MP4の先頭Boxサイズが不正です");
  }
  if (firstBoxSize === 1) {
    if (bytes.length < 24) invalid("MP4の拡張Boxヘッダーが途中で切れています");
    const high = readU32BE(bytes, 8);
    const low = readU32BE(bytes, 12);
    const extendedSize = high * 0x100000000 + low;
    if (!Number.isSafeInteger(extendedSize) || extendedSize < 24 || extendedSize > bytes.length) {
      invalid("MP4の拡張Boxサイズが不正です");
    }
  }
  const majorBrandOffset = firstBoxSize === 1 ? 16 : 8;
  if (!ascii(bytes, majorBrandOffset, 4).trim()) invalid("MP4のブランド情報が不正です");
  return { mimeType: "video/mp4" };
}

function validateWebm(bytes: Uint8Array): VerifiedMediaShape {
  if (!bytesEqual(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) invalid("WebMのEBMLヘッダーを確認できませんでした");
  const limit = Math.min(bytes.length, 4096);
  let hasWebmDocType = false;
  for (let index = 0; index <= limit - 4; index += 1) {
    if (ascii(bytes, index, 4).toLowerCase() === "webm") {
      hasWebmDocType = true;
      break;
    }
  }
  if (!hasWebmDocType) invalid("WebMのDocTypeを確認できませんでした");
  return { mimeType: "video/webm" };
}

function detectMimeType(bytes: Uint8Array): MediaMimeType | null {
  if (bytesEqual(bytes, 0, [0xff, 0xd8])) return "image/jpeg";
  if (bytesEqual(bytes, 0, PNG_SIGNATURE)) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 4) === "ftyp") return "video/mp4";
  if (bytesEqual(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  return null;
}

export function assertMediaNameMatchesMime(
  filename: string,
  storagePath: string,
  mimeType: MediaMimeType,
): void {
  const filenameExtension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")).toLowerCase() : "";
  const storageExtension = storagePath.includes(".") ? storagePath.slice(storagePath.lastIndexOf(".")).toLowerCase() : "";
  const allowedFilenameExtensions: Record<MediaMimeType, readonly string[]> = {
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/webp": [".webp"],
    "video/mp4": [".mp4"],
    "video/webm": [".webm"],
  };
  const expectedStorageExtension: Record<MediaMimeType, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };
  if (!allowedFilenameExtensions[mimeType].includes(filenameExtension)) {
    invalid("ファイル名の拡張子とMIME typeが一致しません");
  }
  if (storageExtension !== expectedStorageExtension[mimeType]) {
    invalid("Storage pathの拡張子とMIME typeが一致しません");
  }
}

export function validateMediaBytes(bytes: Uint8Array, mimeType: MediaMimeType): VerifiedMediaShape {
  if (!bytes.byteLength) invalid("空のファイルはアップロードできません");
  const detected = detectMimeType(bytes);
  if (!detected || detected !== mimeType) {
    invalid("申告されたMIME typeと実ファイル形式が一致しません");
  }

  if (isImageMimeType(mimeType)) {
    if (mimeType === "image/jpeg") return validateJpeg(bytes);
    if (mimeType === "image/png") return validatePng(bytes);
    return validateWebp(bytes);
  }
  if (isVideoMimeType(mimeType)) {
    return mimeType === "video/mp4" ? validateMp4(bytes) : validateWebm(bytes);
  }
  return invalid("対応していないファイル形式です");
}