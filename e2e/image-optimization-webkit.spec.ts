import { expect, test } from "@playwright/test";
import { openPage } from "./navigation";

test("WebKitで画像最適化からDemo Signed Uploadまで完了する", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "webkit", "Safari互換経路をWebKitで検証する");

  await openPage(page, "/reports/new");
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#222222";
    context.fillRect(8, 8, 80, 48);
    const encoded = canvas.toDataURL("image/png").split(",")[1];
    canvas.width = canvas.height = 0;
    return encoded;
  });

  await page.locator('input[type="file"]').setInputFiles({
    name: "webkit-fixture.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });

  await expect(page.locator("#image-optimization-status")).toContainText("画像を最適化しました", { timeout: 30_000 });
  await expect(page.locator(".attachment-item")).toHaveCount(1);
  await expect(page.locator("#attachments-error")).toHaveCount(0);
  await expect(page.locator(".attachment-item small")).toContainText("MiB");
});
