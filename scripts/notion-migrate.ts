import nextEnv from "@next/env";
import {
  Client,
  type UpdateDataSourceParameters,
} from "@notionhq/client";

import {
  IntegrationError,
  toIntegrationFailure,
} from "../src/server/integrations/errors";
import {
  NOTION_DATA_SOURCE_ID,
  NOTION_MANAGED_PROPERTIES,
  NOTION_VERSION,
  planNotionManagedPropertyMigration,
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

async function main(): Promise<void> {
  const token = envValue("NOTION_ACCESS_TOKEN");
  const notionVersion = envValue("NOTION_API_VERSION", NOTION_VERSION);
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
  const before = await notion.dataSources.retrieve({
    data_source_id: dataSourceId,
  });
  const plan = planNotionManagedPropertyMigration(before);
  const managedNames = new Set(Object.keys(NOTION_MANAGED_PROPERTIES));
  const unrelatedIssues = validateNotionDataSourceSchema(before).filter(
    (issue) =>
      !managedNames.has(issue.property) || issue.code !== "MISSING",
  );
  const blockingIssues = [...plan.issues, ...unrelatedIssues].filter(
    (issue, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.property === issue.property && candidate.code === issue.code,
      ) === index,
  );
  if (blockingIssues.length > 0) {
    process.stderr.write(
      `Migration stopped: schema preflight found ${blockingIssues.length} blocking issue(s).\n${blockingIssues
        .map(
          (issue) =>
            `- ${issue.property}: ${issue.code} expected=${issue.expected}`,
        )
        .join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const additions = Object.keys(plan.additions);
  if (additions.length === 0) {
    process.stdout.write("Notion schema is already migrated; no changes made.\n");
    return;
  }

  await notion.dataSources.update({
    data_source_id: dataSourceId,
    properties:
      plan.additions as UpdateDataSourceParameters["properties"],
  });

  const after = await notion.dataSources.retrieve({
    data_source_id: dataSourceId,
  });
  const remaining = planNotionManagedPropertyMigration(after);
  if (
    remaining.issues.length > 0 ||
    Object.keys(remaining.additions).length > 0
  ) {
    throw new IntegrationError("MANAGED_PROPERTY_VERIFICATION_FAILED", {
      retryable: false,
    });
  }

  process.stdout.write(
    `Added Notion properties: ${additions.join(", ")}. No existing properties were changed.\n`,
  );
}

void main().catch((error: unknown) => {
  const failure = toIntegrationFailure("notion", error);
  const status = failure.statusCode ? ` status=${failure.statusCode}` : "";
  process.stderr.write(`Notion migration failed: ${failure.code}${status}\n`);
  process.exitCode = 1;
});
