export function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/[`*_>#\[\]()~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function generateSummary(activityText: string): string {
  return Array.from(plainText(activityText)).slice(0, 100).join("");
}

export function formatJstDate(date: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${date}T00:00:00+09:00`));
}

export function todayInJst(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
