import { expect, test } from "@playwright/test";
import { openPage } from "./navigation";

test("動画を添付して公開し、再生できる", async ({ page }) => {
  test.setTimeout(150_000);
  await openPage(page, "/reports/new");
  await page.getByLabel("活動領域必須").selectOption({ label: "ロボット" });
  await page.getByLabel("内容カテゴリ必須").selectOption({ label: "進捗" });
  await page.getByLabel("今日やったこと必須").fill("動画のアップロードと再生を確認した。");
  const upload = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes("/api/uploads"), { timeout: 30_000 });
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/report-video.mp4");
  expect((await upload).status()).toBe(204);
  await expect(page.locator(".attachment-item")).toContainText("report-video.mp4");
  await page.getByRole("button", { name: "公開する" }).click();
  await expect(page).toHaveURL(/\/reports\/[^/?]+\?published=1$/, { timeout: 90_000 });
  const video = page.locator("video");
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(1);
  await video.evaluate((element: HTMLVideoElement) => { element.muted = true; return element.play(); });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: "動画を開く・ダウンロード" })).toBeVisible();
});
