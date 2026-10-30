import { expect, test } from "@playwright/test";
import { openPage } from "./navigation";

// API mocks must reach Playwright instead of the PWA fetch handler (WebKit).
test.use({ serviceWorkers: "block" });

test("アーカイブの並び順がAPIとURLに反映され、再読み込みで維持される", async ({ page }) => {
  await openPage(page, "/archive");
  const sort = page.getByLabel("並び順", { exact: true });
  for (const value of ["oldest", "popular", "newest"]) {
    const response = page.waitForResponse(response => response.url().includes("/api/reports?") && new URL(response.url()).searchParams.get("sort") === value);
    await sort.selectOption(value);
    const result = await (await response).json();
    await expect(page.getByRole("link", { name: /を読む$/ }).first()).toHaveAttribute("href", `/reports/${result.reports[0].id}`);
    await expect(page).toHaveURL(new RegExp(`sort=${value}`));
  }
  await sort.selectOption("oldest");
  await page.reload();
  await expect(sort).toHaveValue("oldest");
});

test("本文の途中で名前を検索し、キーボードで挿入して前後を編集できる", async ({ page }) => {
  await page.route("**/api/integrations/slack/mentions", route => route.fulfill({ json: [
    { id: "U123ABC", name: "テスト太郎", realName: "山西 遥斗", username: "haruto" },
    { id: "U456DEF", name: "別の人", realName: "別名", username: "another" },
  ] }));
  await openPage(page, "/reports/new");
  const body = page.getByLabel("今日やったこと必須");
  await body.fill("前の文。 後の文。");
  await body.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(5, 5));
  await body.pressSequentially("@ＨＡＲＵ");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(1);
  await body.press("Enter");
  await expect(body).toHaveValue("前の文。 @テスト太郎 後の文。");
  await body.pressSequentially("確認 ");
  await expect(body).toHaveValue("前の文。 @テスト太郎 確認 後の文。");
  await body.press("End");
  await body.pressSequentially(" @");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(2);
  await body.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("管理画面でオンライン状態、日報PV、登録順とクレジットを確認できる", async ({ page }) => {
  await openPage(page, "/");
  await page.getByRole("link", { name: /を読む$/ }).first().click();
  await expect(page.locator(".report-detail__body, .page--report-detail").first()).toBeVisible();
  await expect.poll(async () => (await (await page.request.get("/api/admin/analytics")).json()).reports.reduce((sum: number, report: { views: number }) => sum + report.views, 0)).toBeGreaterThan(0);
  await openPage(page, "/admin");
  await page.getByRole("tab", { name: "利用状況", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "PV", exact: true })).toBeVisible();
  await expect(page.locator(".usage-table tbody tr").first()).toBeVisible();
  await page.getByRole("tab", { name: "メンバー", exact: true }).click();
  const sort = page.getByLabel("メンバーの並び順");
  await expect(sort).toHaveValue("registered-oldest");
  const oldest = await page.locator(".member-row strong").allTextContents();
  await sort.selectOption("registered-newest");
  expect(await page.locator(".member-row strong").allTextContents()).toEqual([...oldest].reverse());
  await expect(page.getByText("● オンライン", { exact: true }).first()).toBeVisible();
  await openPage(page, "/updates");
  await expect(page.getByRole("heading", { name: "パッチノート・クレジット" })).toBeVisible();
  await expect(page.getByRole("link", { name: "X @haruroute1107" })).toHaveAttribute("href", "https://x.com/haruroute1107");
});

test("ユーザーグループをハンドルで検索し、下書きにIDを保持して保存する", async ({ page }) => {
  await page.route("**/api/integrations/slack/mentions", route => route.fulfill({ json: { groupStatus: "available", members: [
    { id: "S123ABC", name: "ロボットチーム", username: "robot", kind: "group", memberCount: 5 },
  ] } }));
  await openPage(page, "/reports/new");
  await page.getByLabel("活動領域必須").selectOption("ロボット");
  await page.getByLabel("内容カテゴリ必須").selectOption("進捗");
  const body = page.getByLabel("今日やったこと必須");
  await body.fill("共有 @robot");
  await page.getByRole("option", { name: /ロボットチーム/ }).click();
  await expect(body).toHaveValue("共有 @ロボットチーム ");
  const request = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/reports");
  await page.getByRole("button", { name: "下書き保存" }).click();
  expect((await request).postDataJSON().activityText).toContain("@[ロボットチーム](slack:S123ABC)");
  await expect(page).toHaveURL(/\/edit\?saved=1$/);
  await page.reload();
  await expect(body).toHaveValue(/@ロボットチーム/);
});
