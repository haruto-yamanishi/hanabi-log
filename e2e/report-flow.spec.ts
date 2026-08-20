import { expect, test } from "@playwright/test";

test.setTimeout(150_000);
const navigationTimeout = 90_000;

test("日報を下書き保存・公開し、検索から詳細を開ける", async ({ page }, testInfo) => {
  const deviceLabel = testInfo.project.name === "mobile" ? "モバイル" : "デスクトップ";
  const uniqueTitle = `E2E ${deviceLabel} 駆動系テスト ${Date.now()}`;
  const activity = `${deviceLabel}表示で、駆動系のギア比とチェーン張力を確認しました。`;

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.locator("main").getByRole("link", { name: "日報を書く", exact: true }).click();

  await expect(page.getByRole("heading", { name: "今日を記録する" })).toBeVisible({ timeout: navigationTimeout });
  await page.getByLabel("タイトル任意").fill(uniqueTitle);
  await page.getByLabel("活動領域必須").selectOption({ label: "ロボット" });
  await page.getByLabel("内容カテゴリ必須").selectOption({ label: "進捗" });
  await page.getByLabel("今日やったこと必須").fill(activity);

  await page.getByRole("button", { name: "下書き保存" }).click();
  await expect(page).toHaveURL(/\/reports\/[^/]+\/edit\?saved=1$/, { timeout: navigationTimeout });
  await expect(page.getByText("下書きを保存しました。外部サービスには配信されていません。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "日報を編集" })).toBeVisible();

  await page.getByRole("button", { name: "公開する" }).click();
  await expect(page).toHaveURL(/\/reports\/[^/?]+\?published=1$/, { timeout: navigationTimeout });
  await expect(page.getByRole("heading", { name: uniqueTitle })).toBeVisible();
  await expect(page.getByText(activity).first()).toBeVisible();
  await expect(page.getByText("日報を公開しました。")).toBeVisible();

  if (testInfo.project.name === "mobile") {
    await page.getByRole("link", { name: "さがす", exact: true }).click();
  } else {
    await page.getByRole("link", { name: "アーカイブ", exact: true }).click();
  }

  await expect(page.getByRole("heading", { name: "日報をさがす" })).toBeVisible();
  await page.getByLabel("キーワード").fill(uniqueTitle);
  await page.getByRole("button", { name: "この条件で検索" }).click();

  const reportLink = page.getByRole("link", { name: `${uniqueTitle}を読む` });
  await expect(reportLink).toBeVisible();
  await reportLink.click();
  await expect(page.getByRole("heading", { name: uniqueTitle })).toBeVisible();
  await expect(page.getByText(activity).first()).toBeVisible();
});

test("タイトルが空欄なら投稿者名から自動生成して公開できる", async ({ page }) => {
  const activity = `タイトル自動生成の確認 ${Date.now()}`;

  await page.goto("/reports/new");
  await expect(page.getByText("空欄なら「あなたの名前の雑多な日報」で保存します。")).toBeVisible();
  await page.getByLabel("活動領域必須").selectOption({ label: "ロボット" });
  await page.getByLabel("内容カテゴリ必須").selectOption({ label: "進捗" });
  await page.getByLabel("今日やったこと必須").fill(activity);
  await page.getByRole("button", { name: "公開する" }).click();

  await expect(page).toHaveURL(/\/reports\/[^/?]+\?published=1$/, { timeout: navigationTimeout });
  await expect(page.getByRole("heading", { name: "HANABI Demoの雑多な日報" })).toBeVisible();
  await expect(page.getByText(activity).first()).toBeVisible();
});
