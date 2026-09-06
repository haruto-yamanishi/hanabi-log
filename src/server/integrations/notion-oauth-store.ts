import "server-only";
import { getDatabase } from "@/server/db/client";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import {
  decryptNotionTokenWithKeyring,
  encryptNotionTokenWithKeyring,
  notionTokenNeedsRotation,
  type NotionTokenKeyring,
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

function currentKey(): string {
  if (!env.NOTION_TOKEN_ENCRYPTION_KEY) {
    throw new AppError(
      "NOTION_ENCRYPTION_NOT_CONFIGURED",
      "Notion OAuthの暗号化キーが設定されていません",
      503,
    );
  }
  return env.NOTION_TOKEN_ENCRYPTION_KEY;
}

export function parseNotionTokenDecryptionKeys(value?: string): Record<string, string> {
  if (!value) return {};
  const result: Record<string, string> = {};
  for (const rawEntry of value.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const separator = entry.indexOf(":");
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error("NOTION_TOKEN_DECRYPTION_KEYS must use key-id:base64 entries");
    }
    const id = entry.slice(0, separator).trim();
    const key = entry.slice(separator + 1).trim();
    if (result[id]) throw new Error(`Duplicate Notion token decryption key id: ${id}`);
    result[id] = key;
  }
  return result;
}

function keyring(): NotionTokenKeyring {
  return {
    currentId: env.NOTION_TOKEN_ENCRYPTION_KEY_ID ?? "primary",
    currentKey: currentKey(),
    decryptionKeys: parseNotionTokenDecryptionKeys(env.NOTION_TOKEN_DECRYPTION_KEYS),
  };
}

function context(botId: string, token: "access" | "refresh"): string {
  return `notion:${botId}:${token}`;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapConnection(
  row: NotionOAuthConnectionRow,
  tokenKeyring: NotionTokenKeyring,
): NotionOAuthConnection {
  return {
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceIconUrl: row.workspace_icon_url,
    botId: row.bot_id,
    ownerUserId: row.owner_user_id,
    ownerUserName: row.owner_user_name,
    accessToken: decryptNotionTokenWithKeyring(
      row.access_token_ciphertext,
      tokenKeyring,
      context(row.bot_id, "access"),
    ),
    refreshToken: row.refresh_token_ciphertext
      ? decryptNotionTokenWithKeyring(
          row.refresh_token_ciphertext,
          tokenKeyring,
          context(row.bot_id, "refresh"),
        )
      : null,
    connectedByMemberId: row.connected_by_member_id,
    connectedAt: iso(row.connected_at),
    updatedAt: iso(row.updated_at),
  };
}

async function rotateConnectionCiphertextIfNeeded(
  row: NotionOAuthConnectionRow,
  connection: NotionOAuthConnection,
  tokenKeyring: NotionTokenKeyring,
): Promise<void> {
  const accessNeedsRotation = notionTokenNeedsRotation(
    row.access_token_ciphertext,
    tokenKeyring,
  );
  const refreshNeedsRotation = Boolean(
    row.refresh_token_ciphertext &&
      notionTokenNeedsRotation(row.refresh_token_ciphertext, tokenKeyring),
  );
  if (!accessNeedsRotation && !refreshNeedsRotation) return;

  const accessCiphertext = encryptNotionTokenWithKeyring(
    connection.accessToken,
    tokenKeyring,
    context(row.bot_id, "access"),
  );
  const refreshCiphertext = connection.refreshToken
    ? encryptNotionTokenWithKeyring(
        connection.refreshToken,
        tokenKeyring,
        context(row.bot_id, "refresh"),
      )
    : null;

  try {
    await getDatabase()`update notion_oauth_connections
      set access_token_ciphertext = ${accessCiphertext},
          refresh_token_ciphertext = ${refreshCiphertext},
          updated_at = now()
      where id = 'primary'
        and access_token_ciphertext = ${row.access_token_ciphertext}`;
  } catch (error) {
    // Decryption succeeded, so a transient rotation write must not break Notion use.
    // Keep previous keys configured until every stored token has migrated.
    console.error("Notion OAuth token re-encryption failed", { error });
  }
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
  const row = rows[0];
  if (!row) return null;
  const tokenKeyring = keyring();
  const connection = mapConnection(row, tokenKeyring);
  await rotateConnectionCiphertextIfNeeded(row, connection, tokenKeyring);
  return connection;
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
  const tokenKeyring = keyring();
  const accessCiphertext = encryptNotionTokenWithKeyring(
    input.accessToken,
    tokenKeyring,
    context(input.botId, "access"),
  );
  const refreshCiphertext = input.refreshToken
    ? encryptNotionTokenWithKeyring(
        input.refreshToken,
        tokenKeyring,
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
