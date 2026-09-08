import { expect, it } from "vitest";
import { fileMimeType } from "@/lib/media";

it("recognizes video extensions when browsers omit a useful MIME type", () => {
  expect(fileMimeType({ name: "IMG_1234.MOV", type: "" })).toBe("video/quicktime");
  expect(fileMimeType({ name: "test.mp4", type: "application/octet-stream" })).toBe("video/mp4");
  expect(fileMimeType({ name: "unsafe.mp4", type: "text/html" })).toBe("text/html");
});
