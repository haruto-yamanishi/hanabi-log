export const MEDIA_MIME_TYPES = [
  "image/jpeg", "image/png", "image/webp",
  "video/mp4", "video/quicktime", "video/webm",
] as const;

export type MediaMimeType = (typeof MEDIA_MIME_TYPES)[number];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export function isVideo(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

export function mediaSizeLimit(mimeType: string): number {
  return isVideo(mimeType) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

export function mediaExtension(mimeType: MediaMimeType): string {
  return {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  }[mimeType];
}

export function fileMimeType(file: { type: string; name: string }): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  return MEDIA_MIME_TYPES.find((type) => mediaExtension(type) === extension)
    ?? (extension === "jpeg" ? "image/jpeg" : file.type);
}
