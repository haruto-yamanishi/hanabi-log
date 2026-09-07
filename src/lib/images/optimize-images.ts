const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const CAPACITY_ERROR = "画像を容量上限（1枚5MiB・添付済み画像を含め合計10MiB）以内に最適化できませんでした。画像の枚数を減らすか、別の画像を選択してください。";

// Each pass applies the same settings to the whole selection. Always redraw
// from the originals to avoid accumulating JPEG/WebP compression artifacts.
const PASSES = [
  { maxDimension: 2560, quality: 0.82 },
  { maxDimension: 2560, quality: 0.75 },
  { maxDimension: 2560, quality: 0.68 },
  { maxDimension: 2560, quality: 0.62 },
  { maxDimension: 2048, quality: 0.62 },
  { maxDimension: 1600, quality: 0.62 },
] as const;

export type OptimizedImage = {
  file: File;
  originalSize: number;
  optimizedSize: number;
  originalMimeType: string;
  optimizedMimeType: string;
  width: number;
  height: number;
};

export type OptimizationOptions = {
  maxTotalBytes?: number;
  maxFileBytes?: number;
  signal?: AbortSignal;
};

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("画像の最適化を中止しました", "AbortError");
  }
}

async function decodeImage(file: File, signal?: AbortSignal): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Some Safari versions cannot decode all supported formats/options with
      // ImageBitmap. HTMLImageElement also applies the image's EXIF orientation.
      throwIfAborted(signal);
    }
  }

  const image = new Image();
  const url = URL.createObjectURL(file);
  const release = () => {
    image.src = "";
    URL.revokeObjectURL(url);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException("画像の最適化を中止しました", "AbortError"));
      };
      image.onload = () => {
        cleanup();
        resolve();
      };
      image.onerror = () => {
        cleanup();
        reject(new Error(`${file.name}を読み込めませんでした。別の画像を選択してください。`));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
      } else {
        image.src = url;
      }
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release };
  } catch (error) {
    release();
    throw error;
  }
}

function outputFilename(filename: string, mimeType: string) {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  const dotIndex = filename.lastIndexOf(".");
  const currentExtension = dotIndex > 0 ? filename.slice(dotIndex + 1).toLowerCase() : "";
  const hasMatchingExtension = currentExtension === extension || (mimeType === "image/jpeg" && currentExtension === "jpeg");
  if (hasMatchingExtension && filename.length <= 255) {
    return filename;
  }
  const stem = (dotIndex > 0 ? filename.slice(0, dotIndex) : filename) || "image";
  const suffix = `.${hasMatchingExtension ? filename.slice(dotIndex + 1) : extension}`;
  let safeStem = "";
  // Match the API's 255-character limit without splitting a Unicode pair.
  for (const character of stem) {
    if (safeStem.length + character.length > 255 - suffix.length) break;
    safeStem += character;
  }
  return `${safeStem}${suffix}`;
}

async function optimizeImage(
  file: File,
  settings: (typeof PASSES)[number],
  signal?: AbortSignal,
): Promise<OptimizedImage> {
  const decoded = await decodeImage(file, signal);
  let canvas: HTMLCanvasElement | undefined;
  try {
    throwIfAborted(signal);
    if (!Number.isFinite(decoded.width) || !Number.isFinite(decoded.height) || decoded.width <= 0 || decoded.height <= 0) {
      throw new Error(`${file.name}の画像サイズを読み取れませんでした。別の画像を選択してください。`);
    }
    const scale = Math.min(1, settings.maxDimension / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("このブラウザでは画像を最適化できませんでした。別のブラウザでお試しください。");
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.source, 0, 0, width, height);

    // PNG/WebP may contain transparency, so never flatten them into JPEG.
    const requestedMimeType = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas!.toBlob((result) => {
        // Unsupported encoders fall back to PNG per the Canvas specification.
        // It is still a new encoding with no source EXIF and preserves alpha.
        if (!result || !result.size || (result.type !== requestedMimeType && result.type !== "image/png")) {
          reject(new Error(`${file.name}を最適化できませんでした。別の画像を選択してください。`));
        } else {
          resolve(result);
        }
      }, requestedMimeType, settings.quality);
    });
    throwIfAborted(signal);
    const optimizedFile = new File([blob], outputFilename(file.name, blob.type), {
      type: blob.type,
      lastModified: file.lastModified,
    });
    return {
      file: optimizedFile,
      originalSize: file.size,
      optimizedSize: optimizedFile.size,
      originalMimeType: file.type,
      optimizedMimeType: optimizedFile.type,
      width,
      height,
    };
  } finally {
    // Release each decoded image and canvas before starting another image.
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    decoded.release();
  }
}

export async function optimizeImages(
  files: readonly File[],
  options: OptimizationOptions = {},
): Promise<OptimizedImage[]> {
  throwIfAborted(options.signal);
  if (!files.length) return [];
  for (const file of files) {
    if (!IMAGE_TYPES.has(file.type)) {
      throw new Error("画像はJPEG・PNG・WebP形式を選択してください。");
    }
  }
  // Callers may reserve capacity for attachments already stored in the report.
  // Options can tighten the limits, but cannot relax the server's limits.
  const maxFileBytes = Math.min(options.maxFileBytes ?? MAX_FILE_BYTES, MAX_FILE_BYTES);
  const maxTotalBytes = Math.min(options.maxTotalBytes ?? MAX_TOTAL_BYTES, MAX_TOTAL_BYTES);
  if (!Number.isFinite(maxFileBytes) || !Number.isFinite(maxTotalBytes) || maxFileBytes <= 0 || maxTotalBytes <= 0) {
    throw new Error(CAPACITY_ERROR);
  }

  const results: OptimizedImage[] = [];
  for (const settings of PASSES) {
    for (const [index, file] of files.entries()) {
      // Give input/paint events time between images without parallel decodes.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      throwIfAborted(options.signal);
      const candidate = await optimizeImage(file, settings, options.signal);
      if (!results[index] || candidate.optimizedSize < results[index].optimizedSize) {
        results[index] = candidate;
      }
    }
    const totalBytes = results.reduce((total, result) => total + result.optimizedSize, 0);
    if (totalBytes <= maxTotalBytes && results.every((result) => result.optimizedSize <= maxFileBytes)) {
      return results;
    }
  }
  throw new Error(CAPACITY_ERROR);
}
