import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Attachment } from "@/lib/types";
import { getDatabase } from "@/server/db/client";
import { env, isDemoMode } from "@/server/env";
import { IntegrationError } from "@/server/integrations/errors";
import type {
  AttachmentContentPort,
  NotionFileDependencies,
  NotionFileUploadStatePort,
} from "@/server/integrations/notion";

export interface PrivateStorageBucket {
  download(
    storagePath: string,
  ): Promise<{ data: Blob | null; error: unknown }>;
}

/** Downloads private objects with the service role; no signed URL is exposed. */
export class SupabasePrivateAttachmentContent
  implements AttachmentContentPort
{
  constructor(private readonly bucket: PrivateStorageBucket) {}

  async load(attachment: Attachment): Promise<Blob> {
    const { data, error } = await this.bucket.download(attachment.storagePath);
    if (error || !data) {
      throw new IntegrationError("PRIVATE_STORAGE_DOWNLOAD_FAILED", {
        retryable: true,
        cause: error,
      });
    }
    return data;
  }
}

type Database = ReturnType<typeof getDatabase>;

interface FileUploadStateRow {
  notion_file_upload_id: string | null;
}

interface UpdatedAttachmentRow {
  id: string;
}

/** Stores retry state on the attachment itself. */
export class PostgresNotionFileUploadState
  implements NotionFileUploadStatePort
{
  constructor(private readonly sql: Database = getDatabase()) {}

  async get(reportId: string, attachmentKey: string): Promise<string | null> {
    const rows = await this.sql<FileUploadStateRow[]>`
      select notion_file_upload_id
      from attachments
      where report_id = ${reportId}
        and (id::text = ${attachmentKey} or storage_path = ${attachmentKey})
      order by case when id::text = ${attachmentKey} then 0 else 1 end
      limit 1
    `;
    return rows[0]?.notion_file_upload_id ?? null;
  }

  async save(
    reportId: string,
    attachmentKey: string,
    fileUploadId: string,
  ): Promise<void> {
    const rows = await this.sql<UpdatedAttachmentRow[]>`
      update attachments
      set notion_file_upload_id = ${fileUploadId}
      where report_id = ${reportId}
        and (id::text = ${attachmentKey} or storage_path = ${attachmentKey})
      returning id::text as id
    `;
    if (!rows[0]) {
      throw new IntegrationError("ATTACHMENT_STATE_NOT_FOUND", {
        retryable: false,
        statusCode: 404,
      });
    }
  }
}

interface DemoObject {
  bytes: Uint8Array;
  mimeType: string;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __hanabiDemoObjects?: Map<string, DemoObject>;
  __hanabiDemoNotionFileUploads?: Map<string, string>;
};

class DemoAttachmentContent implements AttachmentContentPort {
  async load(attachment: Attachment): Promise<Blob> {
    const object = runtimeGlobal.__hanabiDemoObjects?.get(
      attachment.storagePath,
    );
    if (!object) {
      throw new IntegrationError("DEMO_ATTACHMENT_NOT_FOUND", {
        retryable: false,
        statusCode: 404,
      });
    }
    return new Blob([Uint8Array.from(object.bytes).buffer], {
      type: object.mimeType,
    });
  }
}

class DemoNotionFileUploadState implements NotionFileUploadStatePort {
  private values(): Map<string, string> {
    runtimeGlobal.__hanabiDemoNotionFileUploads ??= new Map();
    return runtimeGlobal.__hanabiDemoNotionFileUploads;
  }

  async get(reportId: string, attachmentKey: string): Promise<string | null> {
    return this.values().get(`${reportId}:${attachmentKey}`) ?? null;
  }

  async save(
    reportId: string,
    attachmentKey: string,
    fileUploadId: string,
  ): Promise<void> {
    this.values().set(`${reportId}:${attachmentKey}`, fileUploadId);
  }
}

export function createNotionFileDependencies(
  demoMode = isDemoMode,
): NotionFileDependencies {
  if (demoMode) {
    return {
      content: new DemoAttachmentContent(),
      state: new DemoNotionFileUploadState(),
    };
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    throw new IntegrationError("PRIVATE_STORAGE_ENV_MISSING", {
      retryable: false,
    });
  }

  const client = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return {
    content: new SupabasePrivateAttachmentContent(
      client.storage.from(env.SUPABASE_STORAGE_BUCKET),
    ),
    state: new PostgresNotionFileUploadState(),
  };
}
