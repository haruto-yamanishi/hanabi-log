import { beforeEach, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/types";

vi.mock("server-only", () => ({}));
const db = vi.hoisted(() => ({ queries: [] as string[], locked: [] as object[] }));
vi.mock("@/server/db/client", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((result, segment, index) => result + segment + (index < values.length ? (values[index] as { text?: string })?.text ?? "?" : ""), "").replace(/\s+/g, " ").trim();
    return {
      text,
      then(resolve: (value: object[]) => void) {
        db.queries.push(text);
        resolve(text.includes("for update") ? db.locked : []);
      },
    };
  };
  return { getDatabase: () => Object.assign(sql, { begin: async (run: (tx: typeof sql) => unknown) => run(sql) }) };
});
import { PostgresReportRepository } from "./postgres";
const actor: CurrentUser = { id: "10000000-0000-4000-8000-000000000001", slackUserId: "U_TEST", displayName: "Member", role: "member", isActive: true };
beforeEach(() => { db.queries = []; db.locked = []; });

it("keeps list queries free of detail fields and the integration join by default", async () => {
  const repository = new PostgresReportRepository();
  await repository.listReports({}, actor);
  expect(db.queries).toHaveLength(1);
  expect(db.queries[0]).not.toMatch(/activity_text|learning_text|report_attachments|related_links|join integration_bindings/);
  await repository.listReports({ includeIntegration: true }, { ...actor, role: "admin" });
  expect(db.queries[1]).toContain("join integration_bindings");
  await repository.listReports({ includeIntegration: true }, actor);
  expect(db.queries[2]).not.toContain("join integration_bindings");
});

it("checks locked draft ownership and version before deleting", async () => {
  const repository = new PostgresReportRepository();
  db.locked = [{ id: "draft", author_id: actor.id, status: "published", version: 2 }];
  await expect(repository.deleteReport("draft", actor, 1)).rejects.toMatchObject({ status: 403 });
  expect(db.queries.some((sql) => sql.startsWith("delete"))).toBe(false);
  db.locked = [{ id: "draft", author_id: actor.id, status: "draft", version: 2 }];
  await expect(repository.deleteReport("draft", actor, 1)).rejects.toMatchObject({ status: 409 });
  expect(db.queries.some((sql) => sql.startsWith("delete"))).toBe(false);
  await repository.deleteReport("draft", actor, 2);
  expect(db.queries.at(-1)).toBe("delete from reports where id = ?");
});
