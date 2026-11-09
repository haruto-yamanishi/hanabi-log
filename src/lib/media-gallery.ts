export interface MediaItem {
  id: string;
  reportId: string;
  title: string;
  reportDate: string;
  authorId: string;
  authorName: string;
  filename: string;
  mimeType: string;
  source: "report" | "comment";
  commentId?: string;
  url: string;
}
export interface MediaPage { items: MediaItem[]; nextCursor: string | null }
