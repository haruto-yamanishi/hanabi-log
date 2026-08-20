import { Client, type CreatePageParameters } from "@notionhq/client";

import type { Attachment, IntegrationBinding, Report } from "@/lib/types";
import {
  IntegrationError,
  toIntegrationFailure,
  type IntegrationFailure,
} from "@/server/integrations/errors";
import {
  NOTION_DATA_SOURCE_ID,
  NOTION_VERSION,
} from "@/server/integrations/notion-schema";

export type NotionPageProperties = NonNullable<
  CreatePageParameters["properties"]
>;
export type NotionPageIcon = NonNullable<CreatePageParameters["icon"]>;

export interface NotionPageReference {
  id: string;
  url?: string;
}

export interface NotionCreatePageInput {
  dataSourceId: string;
  properties: NotionPageProperties;
  markdown: string;
  icon: NotionPageIcon;
}

export interface NotionUpdatePageInput {
  pageId: string;
  properties: NotionPageProperties;
  icon: NotionPageIcon;
}

export interface NotionFileUploadInput {
  filename: string;
  mimeType: Attachment["mimeType"];
  data: Blob;
}

export interface NotionImageReference {
  fileUploadId: string;
  altText?: string | null;
}

export interface NotionApiPort {
  findPagesByReportId(
    dataSourceId: string,
    reportId: string,
  ): Promise<NotionPageReference[]>;
  createPage(input: NotionCreatePageInput): Promise<NotionPageReference>;
  updatePage(input: NotionUpdatePageInput): Promise<NotionPageReference>;
  trashPage(pageId: string): Promise<void>;
  replacePageMarkdown(pageId: string, markdown: string): Promise<void>;
  uploadFile(input: NotionFileUploadInput): Promise<string>;
  appendImages(pageId: string, images: NotionImageReference[]): Promise<void>;
}

/** Loads bytes from private storage without exposing a signed URL to Notion. */
export interface AttachmentContentPort {
  load(attachment: Attachment): Promise<Blob>;
}

/**
 * Persists one Notion File Upload ID per attachment. This is required for
 * idempotent retries because a successfully uploaded file can be attached many
 * times without re-uploading its bytes.
 */
export interface NotionFileUploadStatePort {
  get(reportId: string, attachmentKey: string): Promise<string | null>;
  save(
    reportId: string,
    attachmentKey: string,
    fileUploadId: string,
  ): Promise<void>;
}

export interface NotionFileDependencies {
  content: AttachmentContentPort;
  state: NotionFileUploadStatePort;
}

export interface NotionSyncResult {
  pageId: string;
  pageUrl?: string;
  operation: "created" | "updated" | "recovered";
  status: "delivered" | "partial";
  imageFailure?: IntegrationFailure;
}

export interface NotionReportIntegration {
  sync(
    report: Report,
    binding: IntegrationBinding | null,
  ): Promise<NotionSyncResult>;
  refreshProperties(
    report: Report,
    binding: IntegrationBinding,
    pageId: string,
  ): Promise<void>;
  remove(binding: IntegrationBinding | null): Promise<void>;
}

const STATUS_LABEL: Record<Report["status"], string> = {
  draft: "下書き",
  pending_approval: "承認待ち",
  published: "公開",
  archived: "アーカイブ",
};

const ACTIVITY_ICON: Record<Report["activityArea"], string> = {
  ロボット: "🤖",
  アワード: "🏆",
  アウトリーチ: "🤝",
  ブランディング: "🎨",
  チーム運営: "🧭",
  "資金調達・スポンサー": "💴",
  その他: "📝",
};

function text(content: string) {
  return [{ type: "text" as const, text: { content } }];
}

function appReportUrl(appBaseUrl: string, reportId: string): string {
  const url = new URL(appBaseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/reports/${encodeURIComponent(reportId)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function slackDeliveryLabel(
  status: IntegrationBinding["slackStatus"] | undefined,
): string {
  if (status === "delivered") return "配信済み";
  if (status === "dead" || status === "failed" || status === "partial") {
    return "配信失敗";
  }
  return "未配信";
}

export function mapNotionProperties(
  report: Report,
  appBaseUrl: string,
  binding: IntegrationBinding | null = report.integration ?? null,
): NotionPageProperties {
  return {
    日報タイトル: { title: text(report.title) },
    日付: { date: { start: report.reportDate } },
    投稿者: { rich_text: text(report.author.displayName) },
    活動領域: { select: { name: report.activityArea } },
    内容カテゴリ: { select: { name: report.contentCategory } },
    テーマタグ: {
      multi_select: report.themeTags.map((name) => ({ name })),
    },
    要約: { rich_text: text(report.summary ?? "") },
    状態: { select: { name: STATUS_LABEL[report.status] } },
    Slackスレッド: { url: binding?.slackPermalink ?? null },
    Slack配信: {
      select: { name: slackDeliveryLabel(binding?.slackStatus) },
    },
    サンプル: { checkbox: false },
    "Report UUID": { rich_text: text(report.id) },
    アプリURL: { url: appReportUrl(appBaseUrl, report.id) },
  };
}

export function notionPageIcon(report: Report): NotionPageIcon {
  return { type: "emoji", emoji: ACTIVITY_ICON[report.activityArea] };
}

/** Escapes user input so it cannot create Enhanced Markdown blocks or links. */
export function escapeNotionMarkdownText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_{}\[\]()#+\-.!|~])/g, "\\$1");
}

function safeLinkUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url
      .toString()
      .replaceAll("(", "%28")
      .replaceAll(")", "%29");
  } catch {
    return null;
  }
}

function section(title: string, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return `## ${title}\n${escapeNotionMarkdownText(trimmed)}`;
}

export function renderNotionMarkdown(report: Report): string {
  const sections = [
    "> Webアプリから同期された日報です。内容の編集はWebアプリで行ってください。",
    section("今日やったこと", report.activityText),
    section("判断・学び", report.learningText),
    section("課題・相談", report.issueText),
    section("次のアクション", report.nextActionText),
  ].filter((value): value is string => value !== null);

  const links = report.relatedLinks.flatMap((link) => {
    const url = safeLinkUrl(link.url);
    return url
      ? [`- [${escapeNotionMarkdownText(link.label)}](${url})`]
      : [];
  });
  if (links.length > 0) {
    sections.push(`## 関連リンク\n${links.join("\n")}`);
  }

  return `${sections.join("\n\n")}\n`;
}

export class NotionReportService implements NotionReportIntegration {
  constructor(
    private readonly api: NotionApiPort,
    private readonly appBaseUrl: string,
    private readonly dataSourceId = NOTION_DATA_SOURCE_ID,
    private readonly files?: NotionFileDependencies,
  ) {}

  async sync(
    report: Report,
    binding: IntegrationBinding | null,
  ): Promise<NotionSyncResult> {
    const properties = mapNotionProperties(report, this.appBaseUrl, binding);
    const markdown = renderNotionMarkdown(report);
    const icon = notionPageIcon(report);

    if (binding?.notionPageId) {
      const updated = await this.updateExisting(
        binding.notionPageId,
        properties,
        markdown,
        icon,
      );
      return this.withAttachments(report, {
        pageId: updated.id,
        pageUrl: updated.url ?? binding.notionPageUrl ?? undefined,
        operation: "updated",
        status: "delivered",
      });
    }

    const recovered = await this.api.findPagesByReportId(
      this.dataSourceId,
      report.id,
    );
    if (recovered.length > 1) {
      throw new IntegrationError("DUPLICATE_REPORT_UUID", {
        retryable: false,
        statusCode: 409,
      });
    }
    if (recovered[0]) {
      const updated = await this.updateExisting(
        recovered[0].id,
        properties,
        markdown,
        icon,
      );
      return this.withAttachments(report, {
        pageId: updated.id,
        pageUrl: updated.url ?? recovered[0].url,
        operation: "recovered",
        status: "delivered",
      });
    }

    const created = await this.api.createPage({
      dataSourceId: this.dataSourceId,
      properties,
      markdown,
      icon,
    });
    return this.withAttachments(report, {
      pageId: created.id,
      pageUrl: created.url,
      operation: "created",
      status: "delivered",
    });
  }

  async refreshProperties(
    report: Report,
    binding: IntegrationBinding,
    pageId: string,
  ): Promise<void> {
    await this.api.updatePage({
      pageId,
      properties: mapNotionProperties(report, this.appBaseUrl, binding),
      icon: notionPageIcon(report),
    });
  }

  async remove(binding: IntegrationBinding | null): Promise<void> {
    if (!binding?.notionPageId) return;
    await this.api.trashPage(binding.notionPageId);
  }

  private async updateExisting(
    pageId: string,
    properties: NotionPageProperties,
    markdown: string,
    icon: NotionPageIcon,
  ): Promise<NotionPageReference> {
    const updated = await this.api.updatePage({ pageId, properties, icon });
    await this.api.replacePageMarkdown(pageId, markdown);
    return updated;
  }

  private async withAttachments(
    report: Report,
    textResult: NotionSyncResult,
  ): Promise<NotionSyncResult> {
    if (report.attachments.length === 0) return textResult;
    if (!this.files) {
      return {
        ...textResult,
        status: "partial",
        imageFailure: toIntegrationFailure(
          "notion",
          new IntegrationError("FILE_SYNC_NOT_CONFIGURED", {
            retryable: false,
          }),
        ),
      };
    }

    try {
      const images: NotionImageReference[] = [];
      for (const attachment of [...report.attachments].sort(
        (left, right) => left.sortOrder - right.sortOrder,
      )) {
        if (attachment.sizeBytes > 5 * 1024 * 1024) {
          throw new IntegrationError("FILE_TOO_LARGE", {
            retryable: false,
            statusCode: 400,
          });
        }
        const attachmentKey = attachment.id ?? attachment.storagePath;
        let fileUploadId = await this.files.state.get(report.id, attachmentKey);
        if (!fileUploadId) {
          const data = await this.files.content.load(attachment);
          fileUploadId = await this.api.uploadFile({
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            data,
          });
          // Save before attaching so a failed append retries with the same ID.
          await this.files.state.save(report.id, attachmentKey, fileUploadId);
        }
        images.push({ fileUploadId, altText: attachment.altText });
      }
      await this.api.appendImages(textResult.pageId, images);
      return textResult;
    } catch (error) {
      return {
        ...textResult,
        status: "partial",
        imageFailure: toIntegrationFailure("notion", error),
      };
    }
  }
}

function pageReference(value: unknown): NotionPageReference | null {
  if (typeof value !== "object" || value === null) return null;
  const page = value as Record<string, unknown>;
  if (page.object !== "page" || typeof page.id !== "string") return null;
  return {
    id: page.id,
    url: typeof page.url === "string" ? page.url : undefined,
  };
}

export class NotionSdkAdapter implements NotionApiPort {
  private nextRequestAt = 0;
  private rateGate: Promise<void> = Promise.resolve();

  constructor(private readonly client: Client) {}

  static fromToken(
    token: string,
    notionVersion = NOTION_VERSION,
  ): NotionSdkAdapter {
    return new NotionSdkAdapter(
      new Client({
        auth: token,
        notionVersion,
        timeoutMs: 10_000,
        retry: false,
      }),
    );
  }

  async findPagesByReportId(
    dataSourceId: string,
    reportId: string,
  ): Promise<NotionPageReference[]> {
    const response = await this.request(() =>
      this.client.dataSources.query({
        data_source_id: dataSourceId,
        filter: {
          property: "Report UUID",
          rich_text: { equals: reportId },
        },
        page_size: 2,
        result_type: "page",
      }),
    );
    return response.results.flatMap((result) => {
      const page = pageReference(result);
      return page ? [page] : [];
    });
  }

  async createPage(
    input: NotionCreatePageInput,
  ): Promise<NotionPageReference> {
    const response = await this.request(() =>
      this.client.pages.create({
        parent: {
          type: "data_source_id",
          data_source_id: input.dataSourceId,
        },
        properties: input.properties,
        icon: input.icon,
        markdown: input.markdown,
      }),
    );
    const page = pageReference(response);
    if (!page) {
      throw new IntegrationError("RESPONSE_MISSING_PAGE_ID", {
        retryable: true,
      });
    }
    return page;
  }

  async updatePage(
    input: NotionUpdatePageInput,
  ): Promise<NotionPageReference> {
    const response = await this.request(() =>
      this.client.pages.update({
        page_id: input.pageId,
        properties: input.properties,
        icon: input.icon,
      }),
    );
    const page = pageReference(response);
    if (!page) {
      throw new IntegrationError("RESPONSE_MISSING_PAGE_ID", {
        retryable: true,
      });
    }
    return page;
  }

  async trashPage(pageId: string): Promise<void> {
    await this.request(() =>
      this.client.pages.update({
        page_id: pageId,
        in_trash: true,
      }),
    );
  }

  async replacePageMarkdown(pageId: string, markdown: string): Promise<void> {
    await this.request(() =>
      this.client.pages.updateMarkdown({
        page_id: pageId,
        type: "replace_content",
        replace_content: { new_str: markdown },
      }),
    );
  }

  async uploadFile(input: NotionFileUploadInput): Promise<string> {
    const created = await this.request(() =>
      this.client.fileUploads.create({
        mode: "single_part",
        filename: input.filename,
        content_type: input.mimeType,
      }),
    );
    const uploaded = await this.request(() =>
      this.client.fileUploads.send({
        file_upload_id: created.id,
        file: { filename: input.filename, data: input.data },
      }),
    );
    if (uploaded.status !== "uploaded") {
      throw new IntegrationError("FILE_UPLOAD_NOT_READY", {
        retryable: uploaded.status !== "failed",
      });
    }
    return uploaded.id;
  }

  async appendImages(
    pageId: string,
    images: NotionImageReference[],
  ): Promise<void> {
    for (let offset = 0; offset < images.length; offset += 100) {
      await this.request(() =>
        this.client.blocks.children.append({
          block_id: pageId,
          children: images.slice(offset, offset + 100).map((image) => ({
            object: "block" as const,
            type: "image" as const,
            image: {
              type: "file_upload" as const,
              file_upload: { id: image.fileUploadId },
              caption: image.altText
                ? [{ type: "text" as const, text: { content: image.altText } }]
                : [],
            },
          })),
        }),
      );
    }
  }

  private async request<T>(operation: () => Promise<T>): Promise<T> {
    const slot = this.rateGate.then(async () => {
      const waitMs = Math.max(0, this.nextRequestAt - Date.now());
      if (waitMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      }
      // Three requests per second, with a small safety margin.
      this.nextRequestAt = Date.now() + 350;
    });
    this.rateGate = slot.catch(() => undefined);
    await slot;
    return operation();
  }
}

export function createNotionIntegration(input: {
  token: string;
  appBaseUrl: string;
  notionVersion?: string;
  dataSourceId?: string;
  files?: NotionFileDependencies;
}): NotionReportIntegration {
  return new NotionReportService(
    NotionSdkAdapter.fromToken(input.token, input.notionVersion),
    input.appBaseUrl,
    input.dataSourceId,
    input.files,
  );
}
