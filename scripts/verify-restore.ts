import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { z } from "zod";

const manifestSchema = z.object({
  format: z.literal("hanabi-storage-backup-v1"),
  generatedAt: z.string(),
  bucket: z.string(),
  objectCount: z.number().int().nonnegative(),
  objects: z.array(z.object({
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()),
}).strict();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function latestExpectedMigration(): Promise<string> {
  const directory = path.resolve("supabase/migrations");
  const names = (await readdir(directory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  const latest = names.at(-1)?.match(/^(\d+)/)?.[1];
  if (!latest) throw new Error("Could not determine expected schema migration version");
  return latest;
}

async function main(): Promise<void> {
  const manifestPath = path.resolve(process.argv[2] ?? ".restore-drill/input/storage-manifest.json");
  const storageRoot = path.resolve(process.argv[3] ?? ".restore-drill/storage/objects");
  const databaseUrl = required("RESTORE_DATABASE_URL");
  const sql = postgres(databaseUrl, { max: 2, prepare: false });

  try {
    const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
    if (manifest.objectCount !== manifest.objects.length) {
      throw new Error("Storage manifest object count does not match its entries");
    }
    const manifestByPath = new Map(manifest.objects.map((entry) => [entry.path, entry]));

    for (const entry of manifest.objects) {
      const normalized = entry.path.replaceAll("\\", "/");
      if (normalized.split("/").some((part) => !part || part === "." || part === "..")) {
        throw new Error("Unsafe object path in storage manifest");
      }
      const filePath = path.join(storageRoot, ...normalized.split("/"));
      const fileStat = await stat(filePath);
      if (!fileStat.isFile() || fileStat.size !== entry.sizeBytes) {
        throw new Error("Restored storage object size mismatch");
      }
      const digest = createHash("sha256").update(await readFile(filePath)).digest("hex");
      if (digest !== entry.sha256) throw new Error("Restored storage object checksum mismatch");
    }

    const requiredTables = [
      "members",
      "reports",
      "related_links",
      "attachments",
      "integration_bindings",
      "outbox_jobs",
      "idempotency_keys",
    ];
    const tableRows = await sql<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_name in ${sql(requiredTables)}
    `;
    const existingTables = new Set(tableRows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((table) => !existingTables.has(table));
    if (missingTables.length) throw new Error(`Restored DB is missing required tables: ${missingTables.join(", ")}`);

    const integrity = await sql<{
      reports_without_member: number;
      links_without_report: number;
      attachments_without_report: number;
      bindings_without_report: number;
      outbox_without_report: number;
    }[]>`
      select
        (select count(*)::int from reports r left join members m on m.id = r.author_id where m.id is null) as reports_without_member,
        (select count(*)::int from related_links l left join reports r on r.id = l.report_id where r.id is null) as links_without_report,
        (select count(*)::int from attachments a left join reports r on r.id = a.report_id where r.id is null) as attachments_without_report,
        (select count(*)::int from integration_bindings b left join reports r on r.id = b.report_id where r.id is null) as bindings_without_report,
        (select count(*)::int from outbox_jobs o left join reports r on r.id = o.report_id where r.id is null) as outbox_without_report
    `;
    if (Object.values(integrity[0] ?? {}).some((count) => Number(count) !== 0)) {
      throw new Error("Relational integrity check failed in restored database");
    }

    const attachmentRows = await sql<{ storage_path: string; size_bytes: number }[]>`
      select storage_path, size_bytes from attachments order by storage_path
    `;
    for (const attachment of attachmentRows) {
      const entry = manifestByPath.get(attachment.storage_path);
      if (!entry || entry.sizeBytes !== Number(attachment.size_bytes)) {
        throw new Error("Database attachment does not match restored Storage backup");
      }
    }

    const expectedMigration = await latestExpectedMigration();
    const migrationRows = await sql<{ version: string }[]>`
      select version::text as version
      from supabase_migrations.schema_migrations
      where version = ${expectedMigration}
      limit 1
    `;
    if (!migrationRows[0]) {
      throw new Error(`Restored database does not include expected migration ${expectedMigration}`);
    }

    const counts = await sql<{
      members: number;
      reports: number;
      attachments: number;
      outbox: number;
    }[]>`
      select
        (select count(*)::int from members) as members,
        (select count(*)::int from reports) as reports,
        (select count(*)::int from attachments) as attachments,
        (select count(*)::int from outbox_jobs) as outbox
    `;
    const summary = counts[0];
    console.log("Restore verification passed", {
      members: summary?.members ?? 0,
      reports: summary?.reports ?? 0,
      attachments: summary?.attachments ?? 0,
      outbox: summary?.outbox ?? 0,
      storageObjects: manifest.objectCount,
      migration: expectedMigration,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
