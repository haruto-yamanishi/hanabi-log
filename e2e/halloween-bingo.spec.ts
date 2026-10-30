import { test,expect } from "@playwright/test";
test("small Halloween badge opens an accessible participant window",async({page})=>{
 await page.clock.setFixedTime(new Date("2026-10-30T02:00:00Z"));
 await page.route("**/api/bingo",route=>route.fulfill({json:{entries:[{member_id:"one",display_name:"参加メンバー",qualified_at:"2026-10-30T01:00:00Z"}]}}));
 await page.goto("/?bingo=1");
 const dialog=page.getByRole("dialog");
 await expect(dialog).toBeVisible();
 await expect(dialog.getByText("参加メンバー",{exact:true})).toBeVisible();
 await page.keyboard.press("Escape");await expect(dialog).not.toBeVisible();
 await page.getByRole("button",{name:"お土産Halloweenビンゴの参加者を見る"}).click();
 await expect(dialog).toBeVisible();
});
