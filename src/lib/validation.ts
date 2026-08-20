import { z } from "zod";
import {
  ACTIVITY_AREAS,
  CONTENT_CATEGORIES,
  REPORT_STATUSES,
  THEME_TAGS,
} from "@/lib/constants";
import { generateSummary, todayInJst } from "@/lib/text";

const httpsUrl = z.string().url("URLの形式を確認してください").refine(
  (value) => value.startsWith("https://"),
  "HTTPS URLを入力してください",
);

export const relatedLinkSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1, "表示名を入力してください").max(100),
  url: httpsUrl,
  sortOrder: z.number().int().min(0).default(0),
});

export const attachmentSchema = z.object({
  id: z.string().uuid().optional(),
  storagePath: z.string().min(1),
  filename: z.string().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),
  altText: z.string().max(300).nullish(),
  sortOrder: z.number().int().min(0).default(0),
});

export const reportInputSchema = z
  .object({
    reportDate: z.iso.date(),
    title: z.string().trim().max(60, "60文字以内で入力してください"),
    summary: z.string().trim().max(100, "100文字以内で入力してください").optional().default(""),
    activityArea: z.enum(ACTIVITY_AREAS),
    contentCategory: z.enum(CONTENT_CATEGORIES),
    activityText: z.string().trim().min(1, "今日やったことを入力してください").max(10_000),
    learningText: z.string().trim().max(5_000).optional().default(""),
    issueText: z.string().trim().max(5_000).optional().default(""),
    nextActionText: z.string().trim().max(5_000).optional().default(""),
    themeTags: z.array(z.enum(THEME_TAGS)).max(5).optional().default([]),
    relatedLinks: z.array(relatedLinkSchema).max(5).optional().default([]),
    attachments: z.array(attachmentSchema).optional().default([]),
  })
  .superRefine((value, context) => {
    if (value.reportDate > todayInJst()) {
      context.addIssue({
        code: "custom",
        path: ["reportDate"],
        message: "未来の日付は選べません",
      });
    }
    const totalSize = value.attachments.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (totalSize > 10 * 1024 * 1024) {
      context.addIssue({ code: "custom", path: ["attachments"], message: "画像は合計10MiB以内にしてください" });
    }
  })
  .transform((value) => ({
    ...value,
    summary: value.summary || generateSummary(value.activityText),
  }));

export const reportPatchSchema = z.object({
  version: z.number().int().positive(),
  report: reportInputSchema,
});

export const reportFiltersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  activityArea: z.enum(ACTIVITY_AREAS).optional(),
  contentCategory: z.enum(CONTENT_CATEGORIES).optional(),
  themeTag: z.enum(THEME_TAGS).optional(),
  authorId: z.string().uuid().optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  status: z.enum(REPORT_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const uploadRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),
});

export type ValidatedReportInput = z.output<typeof reportInputSchema>;
