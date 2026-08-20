import { uploadRequestSchema } from "@/lib/validation";
import { apiResponse, requestJson } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import {
  acceptDemoUpload,
  createSignedUpload,
  readDemoObject,
} from "@/server/db/storage";
import { AppError } from "@/server/errors";

export async function POST(request: Request): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    const input = uploadRequestSchema.parse(await requestJson(request));
    const origin = new URL(request.url).origin;
    const upload = await createSignedUpload(user, input, origin);
    return Response.json(upload, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}

export async function PUT(request: Request): Promise<Response> {
  return apiResponse(async () => {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    if (!token || url.searchParams.get("mode") !== "upload") {
      throw new AppError("NOT_FOUND", "アップロード先が見つかりません", 404);
    }
    await acceptDemoUpload(token, request);
    return new Response(null, { status: 204 });
  });
}

export async function GET(request: Request): Promise<Response> {
  return apiResponse(async () => {
    await requireCurrentUser();
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const object = token && url.searchParams.get("mode") === "read" ? readDemoObject(token) : null;
    if (!object) throw new AppError("NOT_FOUND", "画像が見つかりません", 404);
    const body = object.bytes.buffer.slice(
      object.bytes.byteOffset,
      object.bytes.byteOffset + object.bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Content-Type": object.mimeType,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
