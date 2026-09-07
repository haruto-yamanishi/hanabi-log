export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const VIDEO_MIME_TYPES = ["video/mp4", "video/webm"] as const;
export const MEDIA_MIME_TYPES = [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];
export type VideoMimeType = (typeof VIDEO_MIME_TYPES)[number];
export type MediaMimeType = (typeof MEDIA_MIME_TYPES)[number];

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const REPORT_MEDIA_MAX_BYTES = 200 * 1024 * 1024;

export function isImageMimeType(value: string): value is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function isVideoMimeType(value: string): value is VideoMimeType {
  return (VIDEO_MIME_TYPES as readonly string[]).includes(value);
}

export function isMediaMimeType(value: string): value is MediaMimeType {
  return (MEDIA_MIME_TYPES as readonly string[]).includes(value);
}

export function maxBytesForMimeType(value: string): number {
  return isVideoMimeType(value) ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
}
