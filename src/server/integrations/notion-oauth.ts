import "server-only";
import {
  Client,
  type UpdateDataSourceParameters,
} from "@notionhq/client";
import type { IntegrationBinding, Report } from "@/lib/types";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import {
  IntegrationError,
  toIntegrationFailure,
} from "@/server/integrations/errors";
import {
  createNotionIntegration,
  type NotionFileDependencies,
  type NotionReportIntegration,
  type NotionSyncResult,
} from "@/server/integrations/notion";
import {
  NOTION_MANAGED_PROPERTIES,
  NOTION_VERSION,
  planNotionManagedPropertyMigration,
  validateNotionDataSourceSchema,
} from "@/server/integrations/notion-schema";
import {
  createNotionOAuthState,
  verifyNotionOAuthState,
} from "@/server/integrations/notion-oauth-crypto";
import {
  deleteNotionOAuthConnection,
  getNotionOAuthConnection,
  saveNotionOAuthConnection,
  type NotionOAuthConnection,
} from "@/server/integrations/notion-oauth-store";

interface NotionOAuthConfig {
  clientId: string;
  clientSecret: string;
  authSecret: string;
  redirectUri: string;
  notionVersion: string;
  databaseId: string;
  dataSourceId: string;
}

function oauthConfig(): NotionOAuthConfig {
  const missing = [
    ["NOTION_OAUTH_CLIENT_ID", env.NOTION_OAUTH_CLIENT_ID],
    ["NOTION_OAUTH_CLIENT_SECRET", env.NOTION_OAUTH_CLIENT_SECRET],
    ["NOTION_TOKEN_ENCRYPTION_KEY", env.NOTION_TOKEN_ENCRYPTION_KEY],
    ["AUTH_SECRET", env.AUTH_SECRET],
    ["APP_BASE_URL", env.APP_BASE_URL],
  ].filter(([, value]) => !value);
  if (missing.length > 0) {
    throw new AppError(
      "NOTION_OAUTH_NOT_CONFIGURED",
      `Notion OAuthの環境変数が不足しています: ${missing.map(([name]) => name).join(", ")}`,
      503,
    );
  }
  return {
    clientId: env.NOTION_OAUTH_CLIENT_ID!,
    clientSecret: env.NOTION_OAUTH_CLIENT_SECRET!,
    authSecret: env.AUTH_SECRET!,
    redirectUri: `${env.APP_BASE_URL!.replace(/\/$/, "")}/api/integrations/notion/callback`,
    notionVersion: env.NOTION_API_VERSION,
    databaseId: env.NOTION_DATABASE_ID,
    dataSourceId: env.NOTION_DATA_SOURCE_ID,
  };
}

function oauthClient(config: NotionOAuthConfig): Client {
  return new Client({
    notionVersion: config.notionVersion,
    timeoutMs: 10_000,
    retry: false,
  });
}

export function createNotionOAuthAuthorizationUrl(memberId: string): string {
  const config = oauthConfig();
  const url = new URL("https://api.notion.com/v1/oauth/authorize");
  url.searchParams.set("owner", "user");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "state",
    createNotionOAuthState(memberId, config.authSecret),
  );
  return url.toString();
}

export function isValidNotionOAuthState(
  state: string,
  memberId: string,
): boolean {
  const config = oauthConfig();
  return verifyNotionOAuthState(state, memberId, config.authSecret);
}

function normalizedId(value: string): string {
  return value.replaceAll("-", "").toLowerCase();
}

async function validateAndMigrateNotionSchema(
  token: string,
  config: NotionOAuthConfig,
): Promise<void> {
  const notion = new Client({
    auth: token,
    notionVersion: config.notionVersion,
    timeoutMs: 10_000,
    retry: false,
  });
  let database;
  let dataSource;
  try {
    [database, dataSource] = await Promise.all([
      notion.databases.retrieve({ database_id: config.databaseId }),
      notion.dataSources.retrieve({ data_source_id: config.dataSourceId }),
    ]);
  } catch (error) {
    const failure = toIntegrationFailure("notion", error);
    if (failure.statusCode !== 403 && failure.statusCode !== 404) throw error;
    throw new AppError(
      "NOTION_DATABASE_NOT_SHARED",
      "Notionの許可画面で「HANABI LOG｜日報アーカイブ」を選択してください",
      422,
      undefined,
    );
  }
  if (
    normalizedId(database.id) !== normalizedId(config.databaseId) ||
    normalizedId(dataSource.id) !== normalizedId(config.dataSourceId)
  ) {
    throw new AppError(
      "NOTION_DATABASE_MISMATCH",
      "選択されたNotionデータベースがHanabi Log用ではありません",
      422,
    );
  }

  const plan = planNotionManagedPropertyMigration(dataSource);
  const managedNames = new Set(Object.keys(NOTION_MANAGED_PROPERTIES));
  const unrelatedIssues = validateNotionDataSourceSchema(dataSource).filter(
    (issue) => !managedNames.has(issue.property) || issue.code !== "MISSING",
  );
  const blockingIssues = [...plan.issues, ...unrelatedIssues].filter(
    (issue, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.property === issue.property && candidate.code === issue.code,
      ) === index,
  );
  if (blockingIssues.length > 0) {
    throw new AppError(
      "NOTION_SCHEMA_INVALID",
      `Notionデータベースの構造を確認してください（${blockingIssues.length}件）`,
      422,
    );
  }

  if (Object.keys(plan.additions).length > 0) {
    await notion.dataSources.update({
      data_source_id: config.dataSourceId,
      properties: plan.additions as UpdateDataSourceParameters["properties"],
    });
  }
  const verified = await notion.dataSources.retrieve({
    data_source_id: config.dataSourceId,
  });
  if (validateNotionDataSourceSchema(verified).length > 0) {
    throw new AppError(
      "NOTION_SCHEMA_MIGRATION_FAILED",
      "Notionデータベースの同期項目を準備できませんでした",
      502,
    );
  }
}

function ownerDetails(owner: unknown): {
  ownerUserId: string | null;
  ownerUserName: string | null;
} {
  if (typeof owner !== "object" || owner === null) {
    return { ownerUserId: null, ownerUserName: null };
  }
  const value = owner as { type?: unknown; user?: unknown };
  if (value.type !== "user" || typeof value.user !== "object" || !value.user) {
    return { ownerUserId: null, ownerUserName: null };
  }
  const user = value.user as { id?: unknown; name?: unknown };
  return {
    ownerUserId: typeof user.id === "string" ? user.id : null,
    ownerUserName: typeof user.name === "string" ? user.name : null,
  };
}

export async function exchangeNotionOAuthCode(
  code: string,
  connectedByMemberId: string,
): Promise<void> {
  const config = oauthConfig();
  const response = await oauthClient(config).oauth.token({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
  await validateAndMigrateNotionSchema(response.access_token, config);
  const owner = ownerDetails(response.owner);
  await saveNotionOAuthConnection({
    workspaceId: response.workspace_id,
    workspaceName: response.workspace_name,
    workspaceIconUrl: response.workspace_icon,
    botId: response.bot_id,
    ...owner,
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    connectedByMemberId,
  });
}

async function refreshConnection(
  connection: NotionOAuthConnection,
): Promise<NotionOAuthConnection> {
  if (!connection.refreshToken) {
    throw new IntegrationError("OAUTH_REFRESH_TOKEN_MISSING", {
      retryable: false,
      statusCode: 401,
    });
  }
  const config = oauthConfig();
  const response = await oauthClient(config).oauth.token({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: connection.refreshToken,
  });
  const owner = ownerDetails(response.owner);
  await saveNotionOAuthConnection({
    workspaceId: response.workspace_id,
    workspaceName: response.workspace_name,
    workspaceIconUrl: response.workspace_icon,
    botId: response.bot_id,
    ...owner,
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? connection.refreshToken,
    connectedByMemberId: connection.connectedByMemberId,
  });
  const updated = await getNotionOAuthConnection();
  if (!updated) {
    throw new IntegrationError("OAUTH_CONNECTION_NOT_FOUND", {
      retryable: false,
      statusCode: 503,
    });
  }
  return updated;
}

async function requireConnection(): Promise<NotionOAuthConnection> {
  const connection = await getNotionOAuthConnection();
  if (!connection) {
    throw new IntegrationError("OAUTH_NOT_CONNECTED", {
      retryable: false,
      statusCode: 503,
    });
  }
  return connection;
}

function unauthorized(error: unknown): boolean {
  return toIntegrationFailure("notion", error).statusCode === 401;
}

export function createOAuthNotionIntegration(input: {
  appBaseUrl: string;
  notionVersion?: string;
  dataSourceId?: string;
  files?: NotionFileDependencies;
}): NotionReportIntegration {
  const integration = (token: string) =>
    createNotionIntegration({
      token,
      appBaseUrl: input.appBaseUrl,
      notionVersion: input.notionVersion,
      dataSourceId: input.dataSourceId,
      files: input.files,
    });

  async function run<T>(
    operation: (service: NotionReportIntegration) => Promise<T>,
  ): Promise<T> {
    const connection = await requireConnection();
    try {
      return await operation(integration(connection.accessToken));
    } catch (error) {
      if (!unauthorized(error)) throw error;
      const refreshed = await refreshConnection(connection);
      return operation(integration(refreshed.accessToken));
    }
  }

  return {
    sync(report: Report, binding: IntegrationBinding | null): Promise<NotionSyncResult> {
      return run((service) => service.sync(report, binding));
    },
    refreshProperties(
      report: Report,
      binding: IntegrationBinding,
      pageId: string,
    ): Promise<void> {
      return run((service) => service.refreshProperties(report, binding, pageId));
    },
    remove(binding: IntegrationBinding | null): Promise<void> {
      if (!binding?.notionPageId) return Promise.resolve();
      return run((service) => service.remove(binding));
    },
  };
}

export async function revokeNotionOAuthConnection(): Promise<void> {
  const connection = await getNotionOAuthConnection();
  if (!connection) return;
  const config = oauthConfig();
  try {
    await oauthClient(config).oauth.revoke({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      token: connection.accessToken,
    });
  } finally {
    await deleteNotionOAuthConnection();
  }
}

export { NOTION_VERSION };
