import { expect, test } from "@playwright/test";

test.setTimeout(150_000);
const navigationTimeout = 90_000;

function publicationLabel(value: string): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.month}月${values.day}日 ${values.hour}時${values.minute}分`;
}

test("PCサイドバーを折りたたみ、状態を保存できる", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "PC用サイドバーの確認");

  await page.goto("/");
  const shell = page.locator(".app-shell");
  const sidebar = page.locator(".sidebar");

  await page.getByRole("button", { name: "メニューを閉じる" }).click();
  await expect(page.getByRole("button", { name: "メニューを開く" })).toBeVisible();
  await expect(shell).toHaveClass(/app-shell--sidebar-collapsed/);
  await expect(sidebar).toHaveClass(/sidebar--collapsed/);
  await expect(sidebar).toHaveCSS("width", "56px");
  await expect(sidebar.locator(".brand__image")).toBeHidden();

  await page.reload();
  await expect(page.getByRole("button", { name: "メニューを開く" })).toBeVisible();
  await expect(shell).toHaveClass(/app-shell--sidebar-collapsed/);
});

test("スマホヘッダーのロゴ周辺に余白があり、マイページの状態表示が四角い", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "スマホ表示の確認");

  await page.goto("/me");
  const logo = page.locator(".mobile-header .brand__image");
  const box = await logo.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(18);
  await expect(page.locator(".member-activity-badge")).toHaveCSS("border-radius", "0px");
});

test("カレンダーで投稿日の件数と日報を確認し、前後月へ移動できる", async ({ page }) => {
  const uniqueTitle = `E2E カレンダー ${Date.now()}`;

  await page.goto("/reports/new");
  await page.getByLabel("タイトル任意").fill(uniqueTitle);
  await page.getByLabel("活動領域必須").selectOption({ label: "事務局" });
  await page.getByLabel("内容カテゴリ必須").selectOption({ label: "進捗" });
  await page.getByLabel("今日やったこと必須").fill("カレンダーから日付ごとの日報を確認した。");
  await page.getByRole("button", { name: "公開する" }).click();
  await expect(page).toHaveURL(/\/reports\/[^/?]+\?published=1$/, { timeout: navigationTimeout });
  const reportId = new URL(page.url()).pathname.split("/").at(-1)!;
  const response = await page.request.get(`/api/reports/${reportId}`);
  const report = await response.json() as { reportDate: string };

  await page.goto(`/calendar?month=${report.reportDate.slice(0, 7)}&date=${report.reportDate}`);
  await expect(page.getByRole("heading", { name: "カレンダー", exact: true })).toBeVisible();
  await expect(page.getByRole("gridcell", { name: new RegExp(`${Number(report.reportDate.slice(-2))}日、\\d+件`) })).toBeVisible();
  await expect(page.getByRole("heading", { name: uniqueTitle })).toBeVisible();

  await page.getByLabel("活動領域").selectOption({ label: "事務局" });
  await expect(page.getByRole("heading", { name: uniqueTitle })).toBeVisible();
  const monthHeading = page.locator("#calendar-month-heading");
  const currentMonth = await monthHeading.textContent();
  await page.getByRole("button", { name: "前月" }).click();
  await expect(monthHeading).not.toHaveText(currentMonth ?? "");
  await page.getByRole("button", { name: "翌月" }).click();
  await expect(monthHeading).toHaveText(currentMonth ?? "");
});

test("日報を下書き保存・公開し、検索から詳細を開ける", async ({ page }, testInfo) => {
  const deviceLabel = testInfo.project.name === "mobile" ? "モバイル" : "デスクトップ";
  const uniqueTitle = `E2E ${deviceLabel} 駆動系テスト ${Date.now()}`;
  const activity = `${deviceLabel}表示で、駆動系のギア比とチェーン張力を確認しました。`;

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.locator(".home-hero__action").click();

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

test("公開日報のいいねを切り替えられる", async ({ page }, testInfo) => {
  const uniqueTitle = `E2E いいね ${testInfo.project.name} ${Date.now()}`;

  await page.goto("/reports/new");
  await page.getByLabel("タイトル任意").fill(uniqueTitle);
  await page.getByLabel("活動領域必須").selectOption({ label: "ロボット" });
  await page.getByLabel("内容カテゴリ必須").selectOption({ label: "進捗" });
  await page.getByLabel("今日やったこと必須").fill("いいねの保存状態を確認した。");
  await page.getByRole("button", { name: "公開する" }).click();
  await expect(page).toHaveURL(/\/reports\/[^/?]+\?published=1$/, { timeout: navigationTimeout });

  const likeButton = page.getByRole("button", { name: /^いいね/ });
  await expect(likeButton).toHaveAttribute("aria-pressed", "false");
  await likeButton.click();
  await expect(likeButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^いいね済み/ })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "いいねしたメンバー" }).getByText("HANABI Demo"),
  ).toBeVisible();
});

test("一覧で投稿時刻を確認し、その場でいいねを切り替えられる", async ({ page }, testInfo) => {
  const uniqueTitle = `E2E 一覧いいね ${testInfo.project.name} ${Date.now()}`;

  await page.goto("/reports/new");
  await expect(page.getByLabel("活動領域必須").locator("option")).toHaveText([
    "選択してください",
    "ロボット",
    "アワード",
    "アウトリーチ",
    "ブランディング",
    "ファンドレイジング",
    "事務局",
    "その他",
  ]);
  await page.getByLabel("タイトル任意").fill(uniqueTitle);
  await page.getByLabel("活動領域必須").selectOption({ label: "事務局" });
  await page.getByLabel("内容カテゴリ必須").selectOption({ label: "進捗" });
  await page.getByLabel("今日やったこと必須").fill("一覧画面の投稿時刻といいね操作を確認した。");
  await page.getByRole("button", { name: "公開する" }).click();
  await expect(page).toHaveURL(/\/reports\/[^/?]+\?published=1$/, { timeout: navigationTimeout });

  const reportId = new URL(page.url()).pathname.split("/").at(-1)!;
  const reportResponse = await page.request.get(`/api/reports/${reportId}`);
  expect(reportResponse.ok()).toBe(true);
  const report = await reportResponse.json() as { publishedAt: string };

  await page.goto("/");
  let card = page.locator("article.report-card").filter({
    has: page.getByRole("heading", { name: uniqueTitle }),
  });
  await expect(card).toBeVisible();
  await expect(card.getByText(publicationLabel(report.publishedAt), { exact: true })).toBeVisible();

  const listLikeButton = card.locator(".report-card__like-button");
  await expect(listLikeButton).toHaveAttribute("aria-pressed", "false");
  await listLikeButton.click();
  await expect(listLikeButton).toHaveAttribute("aria-pressed", "true");
  await expect(listLikeButton).toContainText("1");

  await card.getByRole("link", { name: `${uniqueTitle}を読む` }).click();
  const detailLikeButton = page.getByRole("button", { name: /^いいね済み/ });
  await expect(detailLikeButton).toHaveAttribute("aria-pressed", "true");
  await detailLikeButton.click();
  await expect(page.getByRole("button", { name: /^いいね/ })).toHaveAttribute("aria-pressed", "false");

  await page.goto("/archive");
  await page.getByLabel("キーワード").fill(uniqueTitle);
  await page.getByRole("button", { name: "この条件で検索" }).click();
  const archiveCard = page.locator("article.report-card").filter({
    has: page.getByRole("heading", { name: uniqueTitle }),
  });
  const archiveLikeButton = archiveCard.locator(".report-card__like-button");
  await expect(archiveLikeButton).toHaveAttribute("aria-pressed", "false");
  await archiveLikeButton.click();
  await expect(archiveLikeButton).toHaveAttribute("aria-pressed", "true");
  await archiveCard.getByRole("link", { name: `${uniqueTitle}を読む` }).click();
  await expect(page.getByRole("button", { name: /^いいね済み/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^いいね済み/ }).click();
  await expect(page.getByRole("button", { name: /^いいね/ })).toHaveAttribute("aria-pressed", "false");

  await page.goto("/");
  card = page.locator("article.report-card").filter({
    has: page.getByRole("heading", { name: uniqueTitle }),
  });
  await expect(card.locator(".report-card__like-button")).toHaveAttribute("aria-pressed", "false");
  await expect(card.locator(".report-card__like-button")).toContainText("0");
});

test("管理者が確認後に日報を完全削除できる", async ({ page }) => {
  const uniqueTitle = `E2E 完全削除テスト ${Date.now()}`;

  await page.goto("/reports/new");
  await page.getByLabel("タイトル任意").fill(uniqueTitle);
  await page.getByLabel("活動領域必須").selectOption({ label: "ロボット" });
  await page.getByLabel("内容カテゴリ必須").selectOption({ label: "進捗" });
  await page.getByLabel("今日やったこと必須").fill("完全削除の権限と確認画面を検証した。");
  await page.getByRole("button", { name: "公開する" }).click();

  await expect(page).toHaveURL(/\/reports\/[^/?]+\?published=1$/, { timeout: navigationTimeout });
  const reportId = new URL(page.url()).pathname.split("/").at(-1)!;
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("この操作は元に戻せません");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "完全削除" }).click();

  await expect(page).toHaveURL("/", { timeout: navigationTimeout });
  const deletedResponse = await page.request.get(`/api/reports/${reportId}`);
  expect(deletedResponse.status()).toBe(404);
});
