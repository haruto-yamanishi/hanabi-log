import { describe, expect, it } from "vitest";

import {
  planNotionManagedPropertyMigration,
  validateNotionDataSourceSchema,
} from "@/server/integrations/notion-schema";

describe("Notion schema helpers", () => {
  it("plans only the two integration-managed properties", () => {
    const plan = planNotionManagedPropertyMigration({ properties: {} });
    expect(plan.additions).toEqual({
      "Report UUID": { rich_text: {} },
      アプリURL: { url: {} },
    });
    expect(plan.issues).toEqual([]);
  });

  it("does not replace a managed property with the wrong type", () => {
    const plan = planNotionManagedPropertyMigration({
      properties: { "Report UUID": { type: "url" } },
    });
    expect(plan.additions).not.toHaveProperty("Report UUID");
    expect(plan.issues).toContainEqual({
      property: "Report UUID",
      code: "TYPE_MISMATCH",
      expected: "rich_text",
      actual: "url",
    });
  });

  it("reports missing fixed classification options", () => {
    const issues = validateNotionDataSourceSchema({
      properties: {
        活動領域: {
          type: "select",
          select: { options: [{ name: "ロボット" }] },
        },
      },
    });
    expect(issues).toContainEqual({
      property: "活動領域",
      code: "MISSING_OPTION",
      expected: "アワード",
    });
  });
});
