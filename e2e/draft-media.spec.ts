import { expect, test } from "@playwright/test";
import { openPage } from "./navigation";

test("下書きで画像と動画をプレビューし、メンションと留学・進路を選べる", async ({ page }) => {
  await page.route("**/api/integrations/slack/mentions", route => route.fulfill({ json: [{ id: "U123ABC", name: "テストメンバー", realName: "山西 遥斗", username: "haruto" }] }));
  await openPage(page, "/reports/new");
  await page.getByLabel("活動領域必須").selectOption("その他");
  await page.getByLabel("内容カテゴリ必須").selectOption("留学・進路");
  await page.getByLabel("今日やったこと必須").fill("留学について共有しました。");
  await page.getByLabel("今日やったこと必須").press("End");
  await page.getByLabel("今日やったこと必須").pressSequentially("@山西");
  await page.getByRole("option", { name: /テストメンバー/ }).click();
  await expect(page.getByLabel("今日やったこと必須")).toHaveValue(/@テストメンバー/);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
  const mp4 = Buffer.alloc(20);
  mp4.writeUInt32BE(20, 0); mp4.write("ftyp", 4); mp4.write("isom", 8); mp4.write("isom", 16);
  await page.locator('input[type="file"]').setInputFiles([{ name: "preview.png", mimeType: "image/png", buffer: png }, { name: "preview.mp4", mimeType: "video/mp4", buffer: mp4 }]);
  await expect(page.locator(".attachment-item__preview img")).toBeVisible();
  await expect(page.locator(".attachment-item__preview video")).toBeVisible();
  await expect(page.locator(".attachment-item__preview video")).toHaveAttribute("controls", "");
  await page.getByRole("button", { name: "下書き保存" }).click();
  await expect(page).toHaveURL(/\/edit\?saved=1$/);
  await page.reload();
  await expect(page.getByLabel("今日やったこと必須")).toHaveValue(/@テストメンバー/);
  await expect(page.locator(".attachment-item__preview img")).toBeVisible();
  await expect(page.locator(".attachment-item__preview video")).toBeVisible();
  await page.getByRole("button", { name: "preview.mp4を削除" }).click();
  await expect(page.locator(".attachment-item__preview video")).toHaveCount(0);
  await expect(page.locator(".attachment-item__preview img")).toBeVisible();
});

test("コメントのいいねを追加・解除してSlack由来の件数を維持できる", async ({ page }) => {
  let liked = false;
  const methods: string[] = [];
  await page.route(/\/api\/reports\/[^/]+\/comments$/, route => route.fulfill({ json: { available: true, comments: [{ id: "1800000000.000001", body: "コメントの確認", source: "slack", createdAt: "2026-10-22T12:00:00Z", author: { displayName: "コメント投稿者" }, likeCount: 2, likedByCurrentUser: false }] } }));
  await page.route(/\/api\/reports\/[^/]+\/comments\/1800000000.000001\/like$/, route => {
    methods.push(route.request().method());
    liked = route.request().method() === "PUT";
    return route.fulfill({ json: { likeCount: liked ? 3 : 2, likedByCurrentUser: liked } });
  });
  await openPage(page, "/");
  await page.getByRole("link", { name: /を読む$/ }).first().click();
  const button = page.getByRole("button", { name: "コメント投稿者のコメントにいいね" });
  await expect(button).toContainText("2");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toContainText("3");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button).toContainText("2");
  expect(methods).toEqual(["PUT", "DELETE"]);
});

test("Slackの動画付き返信をコメントの自動更新で表示する", async ({ page }) => {
  let calls = 0;
  await page.route(/\/api\/reports\/[^/]+\/comments$/, route => {
    calls++;
    return route.fulfill({ json: { available: true, comments: calls > 1 ? [{ id: "1800000000.000002", body: "", source: "slack", createdAt: "2026-10-23T12:00:00Z", author: { displayName: "動画投稿者" }, attachments: [{ id: "FTEST", filename: "reply.mp4", mimeType: "video/mp4", url: "/reply.mp4" }] }] : [] } });
  });
  await openPage(page, "/");
  await page.clock.install();
  await page.getByRole("link", { name: /を読む$/ }).first().click();
  await expect(page.getByText("コメントはまだありません。")).toBeVisible();
  await page.clock.fastForward(30_001);
  await expect(page.getByLabel("reply.mp4")).toBeVisible();
  await expect(page.getByLabel("reply.mp4")).toHaveAttribute("controls", "");
  expect(calls).toBeGreaterThan(1);
});
