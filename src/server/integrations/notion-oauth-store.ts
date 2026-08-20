import "server-only";
import { getDatabase } from "@/server/db/client";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import {
  decryptNotionToken,
  encryptNotionToken,
} from "@/server/integrations/notion-oauth-crypto";

interface NotionOAuthConnectionRow {
  workspace_id: string;
  workspace_name: string | null;
  workspace_icon_url: string | null;
  bot_id: string;
  owner_user_id: string | null;
  owner_user_name: string | null;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  connected_by_member_id: string | null;
  connected_at: Date | string;
  updated_at: Date | string;
}

export interface NotionOAuthConnection {
  workspaceId: string;
  workspaceName: string | null;
  workspaceIconUrl: string | null;
  botId: string;
  ownerUserId: string | null;
  ownerUserName: string | null;
  accessToken: string;
  refreshToken: string | null;
  connectedByMemberId: string | null;
  connectedAt: string;
  updatedAt: string;
}

export interface NotionOAuthConnectionSummary {
  connected: boolean;
  workspaceId?: string;
  workspaceName?: string | null;
  workspaceIconUrl?: string | null;
  ownerUserName?: string | null;
  connectedAt?: string;
  updatedAt?: string;
}

export interface SaveNotionOAuthConnectionInput {
  workspaceId: string;
  workspaceName?: string | null;
  workspaceIconUrl?: string | null;
  botId: string;
  ownerUserId?: string | null;
  ownerUserName?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  connectedByMemberId?: string | null;
}

function key(): string {
  if (!env.NOTION_TOKEN_ENCRYPTION_KEY) {
    throw new AppError(
      "NOTION_ENCRYPTION_NOT_CONFIGURED",
      "Notion OAuthの暗号化キーが設定されていません",
      503,
    );
  }
  return env.NOTION_TOKEN_ENCRYPTION_KEY;
}

function context(botId: string, token: "access" | "refresh"): string {
  return `notion:${botId}:${token}`;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapConnection(row: NotionOAuthConnectionRow): NotionOAuthConnection {
  const encryptionKey = key();
  return {
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceIconUrl: row.workspace_icon_url,
    botId: row.bot_id,
    ownerUserId: row.owner_user_id,
    ownerUserName: row.owner_user_name,
    accessToken: decryptNotionToken(
      row.access_token_ciphertext,
      encryptionKey,
      context(row.bot_id, "access"),
    ),
    refreshToken: row.refresh_token_ciphertext
      ? decryptNotionToken(
          row.refresh_token_ciphertext,
          encryptionKey,
          context(row.bot_id, "refresh"),
        )
      : null,
    connectedByMemberId: row.connected_by_member_id,
    connectedAt: iso(row.connected_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function getNotionOAuthConnection(): Promise<NotionOAuthConnection | null> {
  const sql = getDatabase();
  const rows = await sql<NotionOAuthConnectionRow[]>`
    select workspace_id, workspace_name, workspace_icon_url, bot_id,
           owner_user_id, owner_user_name, access_token_ciphertext,
           refresh_token_ciphertext, connected_by_member_id,
           connected_at, updated_at
    from notion_oauth_connections
    where id = 'primary'
  `;
  return rows[0] ? mapConnection(rows[0]) : null;
}

export async function getNotionOAuthConnectionSummary(): Promise<NotionOAuthConnectionSummary> {
  const sql = getDatabase();
  const rows = await sql<
    Pick<
      NotionOAuthConnectionRow,
      | "workspace_id"
      | "workspace_name"
      | "workspace_icon_url"
      | "owner_user_name"
      | "connected_at"
      | "updated_at"
    >[]
  >`
    select workspace_id, workspace_name, workspace_icon_url, owner_user_name,
           connected_at, updated_at
    from notion_oauth_connections
    where id = 'primary'
  `;
  const row = rows[0];
  if (!row) return { connected: false };
  return {
    connected: true,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceIconUrl: row.workspace_icon_url,
    ownerUserName: row.owner_user_name,
    connectedAt: iso(row.connected_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function saveNotionOAuthConnection(
  input: SaveNotionOAuthConnectionInput,
): Promise<void> {
  const sql = getDatabase();
  const encryptionKey = key();
  const accessCiphertext = encryptNotionToken(
    input.accessToken,
    encryptionKey,
    context(input.botId, "access"),
  );
  const refreshCiphertext = input.refreshToken
    ? encryptNotionToken(
        input.refreshToken,
        encryptionKey,
        context(input.botId, "refresh"),
      )
    : null;
  await sql`
    insert into notion_oauth_connections (
      id, workspace_id, workspace_name, workspace_icon_url, bot_id,
      owner_user_id, owner_user_name, access_token_ciphertext,
      refresh_token_ciphertext, connected_by_member_id, connected_at, updated_at
    ) values (
      'primary', ${input.workspaceId}, ${input.workspaceName ?? null},
      ${input.workspaceIconUrl ?? null}, ${input.botId},
      ${input.ownerUserId ?? null}, ${input.ownerUserName ?? null},
      ${accessCiphertext}, ${refreshCiphertext},
      ${input.connectedByMemberId ?? null}, now(), now()
    )
    on conflict (id) do update set
      workspace_id = excluded.workspace_id,
      workspace_name = excluded.workspace_name,
      workspace_icon_url = excluded.workspace_icon_url,
      bot_id = excluded.bot_id,
      owner_user_id = excluded.owner_user_id,
      owner_user_name = excluded.owner_user_name,
      access_token_ciphertext = excluded.access_token_ciphertext,
      refresh_token_ciphertext = excluded.refresh_token_ciphertext,
      connected_by_member_id = excluded.connected_by_member_id,
      connected_at = now(),
      updated_at = now()
  `;
}

export async function deleteNotionOAuthConnection(): Promise<void> {
  await getDatabase()`delete from notion_oauth_connections where id = 'primary'`;
}
