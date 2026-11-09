import { expect, it } from "vitest";
import { editMentionText, matchesMention, mentionDocument } from "./mention-editor";
const token = "@[テスト 太郎](slack:U123ABC)";
it("searches real names and handles across width, spaces and kana", () => {
  const user = { id: "U1", name: "たろう", realName: "山西 遥斗", username: "Haruto" };
  expect(matchesMention(user, "山西遥斗")).toBe(true);
  expect(matchesMention(user, "ＨＡＲＵ")).toBe(true);
  expect(matchesMention(user, "タロウ")).toBe(true);
  expect(matchesMention(user, "別人")).toBe(false);
});
it("keeps IDs through edits before and after multiple mentions", () => {
  const raw = `前 ${token} 後 ${token}`;
  expect(mentionDocument(raw).text).toBe("前 @テスト 太郎 後 @テスト 太郎");
  expect(editMentionText(raw, "追加 前 @テスト 太郎 後 @テスト 太郎")).toBe(`追加 ${raw}`);
  expect(editMentionText(raw, "前 @テスト 太郎 後 @テスト 太郎 追記")).toBe(`${raw} 追記`);
  expect(editMentionText(raw, "前 @テスト 太郎 変更 @テスト 太郎")).toBe(`前 ${token} 変更 ${token}`);
});
it("removes notification identity when a mention itself is edited or removed", () => {
  expect(editMentionText(token, "@テスト 次郎")).toBe("@テスト 次郎");
  expect(editMentionText(`前 ${token} 後`, "前  後")).toBe("前  後");
  expect(editMentionText(token, "@テスト 太")).toBe("@テスト 太");
});
it("preserves group IDs while showing the group name and searching its handle", () => {
  const raw = "@[ロボットチーム](slack:S123ABC) へ共有";
  expect(mentionDocument(raw).text).toBe("@ロボットチーム へ共有");
  expect(editMentionText(raw, "@ロボットチーム へ共有しました")).toBe(`${raw}しました`);
  expect(matchesMention({ id: "S123ABC", kind: "group", name: "ロボットチーム", username: "robot" }, "ＲＯＢＯＴ")).toBe(true);
});
