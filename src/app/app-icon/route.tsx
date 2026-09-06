import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get("size"));
  const size = [180, 192, 512].includes(requested) ? requested : 512;
  const logo = await readFile(join(process.cwd(), "public/brand/hanabi-normal.png"));
  return new ImageResponse(
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background: "white" }}>
      {/* Keep the complete logo inside the maskable icon safe zone. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="" src={`data:image/png;base64,${logo.toString("base64")}`} width={size * 0.625} height={size * 0.625 * 1581 / 2170} />
    </div>,
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
