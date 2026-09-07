import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const databaseDump = path.resolve(process.argv[2] ?? ".restore-drill/hanabi-db.dump");
  const storageArchive = path.resolve(process.argv[3] ?? ".restore-drill/hanabi-storage.tar.gz");
  const storageManifest = path.resolve(process.argv[4] ?? ".restore-drill/storage/manifest.json");
  const backup = createClient(
    required("BACKUP_SUPABASE_URL"),
    required("BACKUP_SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const bucket = process.env.BACKUP_SUPABASE_STORAGE_BUCKET?.trim() || "hanabi-log-backups";
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const commit = (process.env.GITHUB_SHA || "manual").slice(0, 12);
  const backupId = `${timestamp}-${commit}`;

  const { data: buckets, error: bucketListError } = await backup.storage.listBuckets();
  if (bucketListError) throw new Error(`Could not inspect backup bucket: ${bucketListError.message}`);
  if (!buckets?.some((candidate) => candidate.name === bucket)) {
    const { error } = await backup.storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: 1024 * 1024 * 1024,
    });
    if (error) throw new Error(`Could not create private backup bucket: ${error.message}`);
  }

  const files = [
    { key: "database.dump", file: databaseDump, contentType: "application/octet-stream" },
    { key: "storage.tar.gz", file: storageArchive, contentType: "application/gzip" },
    { key: "storage-manifest.json", file: storageManifest, contentType: "application/json" },
  ];
  for (const item of files) {
    const bytes = await readFile(item.file);
    const { error } = await backup.storage.from(bucket).upload(
      `${backupId}/${item.key}`,
      bytes,
      { upsert: false, contentType: item.contentType, cacheControl: "0" },
    );
    if (error) throw new Error(`Could not persist ${item.key} backup: ${error.message}`);
  }

  const pointer = Buffer.from(JSON.stringify({
    format: "hanabi-backup-pointer-v1",
    backupId,
    createdAt: new Date().toISOString(),
    sourceCommit: process.env.GITHUB_SHA || null,
  }));
  const { error: pointerError } = await backup.storage.from(bucket).upload(
    "latest.json",
    pointer,
    { upsert: true, contentType: "application/json", cacheControl: "0" },
  );
  if (pointerError) throw new Error(`Could not update latest backup pointer: ${pointerError.message}`);

  console.log(`Backup persisted successfully: ${backupId}`);
}

await main();
