import { describe, expect, it } from "vitest";
import { roleChangeNotice } from "./role-change-notice";

describe("roleChangeNotice", () => {
  it("mentions the acting admin and explains Media publication permissions", () => {
    const text = roleChangeNotice("media", "山西遥斗", "U123ABC");
    expect(text).toContain("admin <@U123ABC>（山西遥斗）によってあなたにmediaメンバーの権限が付与されました");
    expect(text).toContain("X・Instagram・note・IGNITERS・その他");
    expect(text).toContain("投稿本文とURL");
  });

  it("notifies Admin promotion and Member reversion using that admin's identity", () => {
    expect(roleChangeNotice("admin", "別の管理者", "U234BCD"))
      .toContain("admin <@U234BCD>（別の管理者）によってあなたにadmin権限が付与されました");
    expect(roleChangeNotice("member", "別の管理者", "U234BCD"))
      .toContain("admin <@U234BCD>（別の管理者）によってあなたの権限がmemberに変更されました");
  });

  it("escapes display names without removing the Slack mention", () => {
    expect(roleChangeNotice("member", "<everyone>&", "U234BCD"))
      .toContain("<@U234BCD>（&lt;everyone&gt;&amp;）");
  });
});
