export const ACTIVITY_AREAS = [
  "ロボット",
  "アワード",
  "アウトリーチ",
  "ブランディング",
  "ファンドレイジング",
  "事務局",
  "その他",
] as const;

export type ActivityArea = (typeof ACTIVITY_AREAS)[number];

const ACTIVITY_AREA_CLASS_NAMES: Record<ActivityArea, string> = {
  ロボット: "activity-area--robot",
  アワード: "activity-area--award",
  アウトリーチ: "activity-area--outreach",
  ブランディング: "activity-area--branding",
  ファンドレイジング: "activity-area--fundraising",
  事務局: "activity-area--operations",
  その他: "activity-area--other",
};

export function activityAreaClassName(area: ActivityArea): string {
  return ACTIVITY_AREA_CLASS_NAMES[area];
}

export const CONTENT_CATEGORIES = [
  "進捗",
  "判断・意思決定",
  "調査・学び",
  "課題・相談",
  "会議・共有",
  "成果",
  "次のアクション",
] as const;

export const THEME_TAGS = [
  "機械",
  "電装",
  "ソフトウェア",
  "CAD・設計",
  "製作",
  "競技",
  "スポンサー",
  "広報・SNS",
  "イベント",
  "教育",
  "採用・育成",
  "その他",
] as const;

export const REPORT_STATUSES = ["draft", "pending_approval", "published", "archived"] as const;
export const DELIVERY_TARGETS = ["slack", "notion"] as const;
export const DELIVERY_STATUSES = [
  "pending",
  "processing",
  "delivered",
  "partial",
  "failed",
  "dead",
] as const;

export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];
export type ThemeTag = (typeof THEME_TAGS)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type DeliveryTarget = (typeof DELIVERY_TARGETS)[number];
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const NOTION_API_VERSION = "2026-03-11";
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000] as const;
