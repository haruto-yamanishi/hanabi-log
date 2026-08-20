const monthPattern = /^(\d{4})-(\d{2})$/;

export function isCalendarMonth(value: string): boolean {
  const match = monthPattern.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

export function monthBounds(month: string): { dateFrom: string; dateTo: string } {
  if (!isCalendarMonth(month)) throw new Error("Invalid calendar month");
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    dateFrom: `${month}-01`,
    dateTo: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function isDateInCalendarMonth(date: string, month: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isCalendarMonth(month)) return false;
  const { dateFrom, dateTo } = monthBounds(month);
  return date >= dateFrom && date <= dateTo;
}

export function shiftCalendarMonth(month: string, amount: number): string {
  if (!isCalendarMonth(month)) throw new Error("Invalid calendar month");
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function calendarCells(month: string): Array<string | null> {
  const { dateTo } = monthBounds(month);
  const [year, monthNumber] = month.split("-").map(Number);
  const firstWeekday = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const lastDay = Number(dateTo.slice(-2));
  const cells: Array<string | null> = Array(firstWeekday).fill(null);
  for (let day = 1; day <= lastDay; day += 1) {
    cells.push(`${month}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function formatCalendarMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${year}年${monthNumber}月`;
}
