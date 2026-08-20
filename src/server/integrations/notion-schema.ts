import {
  ACTIVITY_AREAS,
  CONTENT_CATEGORIES,
  THEME_TAGS,
} from "@/lib/constants";

export const NOTION_DATABASE_ID = "212fffe9-1997-4b7c-a631-13629baa8977";
export const NOTION_DATA_SOURCE_ID = "aff207bb-2f47-4f19-beba-ae9556bdf442";
export const NOTION_VERSION = "2026-03-11";

interface SelectOption {
  name?: unknown;
}

interface PropertySchema {
  type?: unknown;
  select?: { options?: SelectOption[] };
  multi_select?: { options?: SelectOption[] };
}

export interface NotionDataSourceSchema {
  properties?: Record<string, PropertySchema>;
}

export interface NotionSchemaIssue {
  property: string;
  code: "MISSING" | "TYPE_MISMATCH" | "MISSING_OPTION";
  expected: string;
  actual?: string;
}

interface ExpectedProperty {
  type: string;
  options?: readonly string[];
}

export const NOTION_EXPECTED_PROPERTIES: Readonly<
  Record<string, ExpectedProperty>
> = {
  日報タイトル: { type: "title" },
  日付: { type: "date" },
  投稿者: { type: "rich_text" },
  活動領域: { type: "select", options: ACTIVITY_AREAS },
  内容カテゴリ: { type: "select", options: CONTENT_CATEGORIES },
  テーマタグ: { type: "multi_select", options: THEME_TAGS },
  要約: { type: "rich_text" },
  状態: { type: "select", options: ["下書き", "公開", "アーカイブ"] },
  Slackスレッド: { type: "url" },
  Slack配信: { type: "select", options: ["未配信", "配信済み", "配信失敗"] },
  サンプル: { type: "checkbox" },
  "Log ID": { type: "unique_id" },
  作成日時: { type: "created_time" },
  更新日時: { type: "last_edited_time" },
  "Report UUID": { type: "rich_text" },
  アプリURL: { type: "url" },
};

export const NOTION_MANAGED_PROPERTIES = {
  "Report UUID": { rich_text: {} },
  アプリURL: { url: {} },
} as const;

type NotionManagedPropertyAdditions = {
  -readonly [Key in keyof typeof NOTION_MANAGED_PROPERTIES]?:
    (typeof NOTION_MANAGED_PROPERTIES)[Key];
};

function optionNames(property: PropertySchema, type: string): Set<string> {
  const raw =
    type === "multi_select"
      ? property.multi_select?.options
      : property.select?.options;
  return new Set(
    (raw ?? [])
      .map((option) => option.name)
      .filter((name): name is string => typeof name === "string"),
  );
}

export function validateNotionDataSourceSchema(
  schema: NotionDataSourceSchema,
): NotionSchemaIssue[] {
  const properties = schema.properties ?? {};
  const issues: NotionSchemaIssue[] = [];

  for (const [name, expected] of Object.entries(NOTION_EXPECTED_PROPERTIES)) {
    const property = properties[name];
    if (!property) {
      issues.push({
        property: name,
        code: "MISSING",
        expected: expected.type,
      });
      continue;
    }

    if (property.type !== expected.type) {
      issues.push({
        property: name,
        code: "TYPE_MISMATCH",
        expected: expected.type,
        actual:
          typeof property.type === "string" ? property.type : "unknown",
      });
      continue;
    }

    if (expected.options) {
      const actualOptions = optionNames(property, expected.type);
      for (const option of expected.options) {
        if (!actualOptions.has(option)) {
          issues.push({
            property: name,
            code: "MISSING_OPTION",
            expected: option,
          });
        }
      }
    }
  }

  return issues;
}

export function planNotionManagedPropertyMigration(
  schema: NotionDataSourceSchema,
): {
  additions: NotionManagedPropertyAdditions;
  issues: NotionSchemaIssue[];
} {
  const properties = schema.properties ?? {};
  const additions: NotionManagedPropertyAdditions = {};
  const issues: NotionSchemaIssue[] = [];

  for (const [name, definition] of Object.entries(
    NOTION_MANAGED_PROPERTIES,
  ) as Array<
    [
      keyof typeof NOTION_MANAGED_PROPERTIES,
      (typeof NOTION_MANAGED_PROPERTIES)[keyof typeof NOTION_MANAGED_PROPERTIES],
    ]
  >) {
    const current = properties[name];
    const expectedType = name === "Report UUID" ? "rich_text" : "url";
    if (!current) {
      additions[name] = definition as never;
    } else if (current.type !== expectedType) {
      issues.push({
        property: name,
        code: "TYPE_MISMATCH",
        expected: expectedType,
        actual: typeof current.type === "string" ? current.type : "unknown",
      });
    }
  }

  return { additions, issues };
}
