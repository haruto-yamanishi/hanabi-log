import nextEnv from "@next/env";
import { Client } from "@notionhq/client";

import {
  IntegrationError,
  toIntegrationFailure,
} from "../src/server/integrations/errors";
import {
  NOTION_DATABASE_ID,
  NOTION_DATA_SOURCE_ID,
  NOTION_VERSION,
  validateNotionDataSourceSchema,
} from "../src/server/integrations/notion-schema";

nextEnv.loadEnvConfig(process.cwd());

function envValue(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!value) {
    throw new IntegrationError(`MISSING_${name}`, { retryable: false });
  }
  return value;
}

function normalizedId(value: string): string {
  return value.replaceAll("-", "").toLowerCase();
}

function propertyIssueText(
  issue: ReturnType<typeof validateNotionDataSourceSchema>[number],
): string {
  const actual = issue.actual ? ` actual=${issue.actual}` : "";
  return `- ${issue.property}: ${issue.code} expected=${issue.expected}${actual}`;
}

async function main(): Promise<void> {
  const token = envValue("NOTION_ACCESS_TOKEN");
  const notionVersion = envValue("NOTION_API_VERSION", NOTION_VERSION);
  const databaseId = envValue("NOTION_DATABASE_ID", NOTION_DATABASE_ID);
  const dataSourceId = envValue(
    "NOTION_DATA_SOURCE_ID",
    NOTION_DATA_SOURCE_ID,
  );
  if (notionVersion !== NOTION_VERSION) {
    throw new IntegrationError("API_VERSION_MUST_BE_2026_03_11", {
      retryable: false,
    });
  }

  const notion = new Client({
    auth: token,
    notionVersion,
    timeoutMs: 10_000,
    retry: false,
  });
  const [database, dataSource] = await Promise.all([
    notion.databases.retrieve({ database_id: databaseId }),
    notion.dataSources.retrieve({ data_source_id: dataSourceId }),
  ]);

  if (normalizedId(database.id) !== normalizedId(databaseId)) {
    throw new IntegrationError("DATABASE_ID_MISMATCH", { retryable: false });
  }
  if (normalizedId(dataSource.id) !== normalizedId(dataSourceId)) {
    throw new IntegrationError("DATA_SOURCE_ID_MISMATCH", {
      retryable: false,
    });
  }
  if (
    "parent" in dataSource &&
    "database_id" in dataSource.parent &&
    normalizedId(dataSource.parent.database_id) !== normalizedId(databaseId)
  ) {
    throw new IntegrationError("DATA_SOURCE_PARENT_MISMATCH", {
      retryable: false,
    });
  }

  const issues = validateNotionDataSourceSchema(dataSource);
  if (issues.length > 0) {
    process.stderr.write(
      `Notion schema check failed (${issues.length} issues).\n${issues
        .map(propertyIssueText)
        .join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Notion connection and schema are valid (API ${notionVersion}, ${Object.keys(dataSource.properties).length} properties).\n`,
  );
}

void main().catch((error: unknown) => {
  const failure = toIntegrationFailure("notion", error);
  const status = failure.statusCode ? ` status=${failure.statusCode}` : "";
  process.stderr.write(`Notion check failed: ${failure.code}${status}\n`);
  process.exitCode = 1;
});
