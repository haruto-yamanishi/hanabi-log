import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

interface ManifestEntry {
  path: string;
  sizeBytes: number;
  sha256: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeStoragePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Unsafe storage object path in backup source");
  }
  return normalized;
}

async function main(): Promise<void> {
  const outputRoot = path.resolve(process.argv[2] ?? ".restore-drill/storage");
  const objectRoot = path.join(outputRoot, "objects");
  await mkdir(objectRoot, { recursive: true });

  const source = createClient(
    required("PRODUCTION_SUPABASE_URL"),
    required("PRODUCTION_SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const bucket = process.env.PRODUCTION_SUPABASE_STORAGE_BUCKET?.trim() || "hanabi-log-private";
  const manifest: ManifestEntry[] = [];

  async function walk(prefix = ""): Promise<void> {
    let offset = 0;
    while (true) {
      const { data, error } = await source.storage.from(bucket).list(prefix, {
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`Could not list private storage backup source: ${error.message}`);
      if (!data?.length) break;

      for (const item of data) {
        const objectPath = safeStoragePath(prefix ? `${prefix}/${item.name}` : item.name);
        const size = Number(item.metadata?.size);
        if (!Number.isFinite(size)) {
          await walk(objectPath);
          continue;
        }
        const { data: blob, error: downloadError } = await source.storage.from(bucket).download(objectPath);
        if (downloadError || !blob) {
          throw new Error(`Could not download a private storage object for backup: ${downloadError?.message ?? "unknown"}`);
        }
        const bytes = Buffer.from(await blob.arrayBuffer());
        if (bytes.byteLength !== size) throw new Error("Storage object size changed during backup");
        const destination = path.join(objectRoot, ...objectPath.split("/"));
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, bytes, { flag: "wx" });
        manifest.push({
          path: objectPath,
          sizeBytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }

      if (data.length < 1000) break;
      offset += data.length;
    }
  }

  await walk();
  manifest.sort((left, right) => left.path.localeCompare(right.path));
  await writeFile(
    path.join(outputRoot, "manifest.json"),
    JSON.stringify(
      {
        format: "hanabi-storage-backup-v1",
        generatedAt: new Date().toISOString(),
        bucket,
        objectCount: manifest.length,
        objects: manifest,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  console.log(`Storage backup prepared: ${manifest.length} objects`);
}

await main();
