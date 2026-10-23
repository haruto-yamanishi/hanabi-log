export interface UsageAnalytics {
  startedAt: string;
  members: { id: string; registeredAt: string; lastSeenAt: string | null; online: boolean }[];
  reports: { id: string; title: string; authorName: string; views: number; viewers: number }[];
}
