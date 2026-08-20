const DEFAULT_TITLE_SUFFIX = "の雑多な日報";
const MAX_TITLE_LENGTH = 60;

function takeCharacters(value: string, length: number): string {
  return Array.from(value).slice(0, length).join("");
}

export function resolveReportTitle(title: string, displayName: string): string {
  const enteredTitle = title.trim();
  if (enteredTitle) return enteredTitle;

  const name = displayName.trim() || "Hanabiメンバー";
  const availableNameLength = MAX_TITLE_LENGTH - Array.from(DEFAULT_TITLE_SUFFIX).length;
  return `${takeCharacters(name, availableNameLength)}${DEFAULT_TITLE_SUFFIX}`;
}
