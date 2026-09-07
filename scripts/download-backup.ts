import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const pointerSchema = z.object({
  format: z.literal("hanabi-backup-pointer-v1"),
  backupId: z.string().min(1).max(200).regex(/^[A-Za-z0-9._-]+$/),
  createdAt: z.string(),
  sourceCommit: z.string().nullable().optional(),
}).strict();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function downloadObject(
  client: ReturnType<typeof createClient>,
  bucket: string,
  objectPath: string,
  destination: string,
): Promise<void> {
  const { data, error } = await client.storage.from(bucket).download(objectPath);
  if (error || !data) throw new Error(`Could not download restore input: ${error?.message ?? "unknown"}`);
  await writeFile(destination, Buffer.from(await data.arrayBuffer()), { flag: "wx" });
}

async function main(): Promise<void> {
  const outputRoot = path.resolve(process.argv[2] ?? ".restore-drill/input");
  await mkdir(outputRoot, { recursive: true });
  const client = createClient(
    required("BACKUP_SUPABASE_URL"),
    required("BACKUP_SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const bucket = process.env.BACKUP_SUPABASE_STORAGE_BUCKET?.trim() || "hanabi-log-backups";

  const { data: pointerBlob, error: pointerError } = await client.storage.from(bucket).download("latest.json");
  if (pointerError || !pointerBlob) {
    throw new Error(`Could not read latest backup pointer: ${pointerError?.message ?? "unknown"}`);
  }
  const pointer = pointerSchema.parse(JSON.parse(await pointerBlob.text()));

  await downloadObject(client, bucket, `${pointer.backupId}/database.dump`, path.join(outputRoot, "database.dump"));
  await downloadObject(client, bucket, `${pointer.backupId}/storage.tar.gz`, path.join(outputRoot, "storage.tar.gz"));
  await downloadObject(client, bucket, `${pointer.backupId}/storage-manifest.json`, path.join(outputRoot, "storage-manifest.json"));
  await writeFile(path.join(outputRoot, "backup-pointer.json"), JSON.stringify(pointer, null, 2), { flag: "wx" });
  console.log(`Restore input downloaded: ${pointer.backupId}`);
}

await main();
