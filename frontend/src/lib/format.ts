/** Backend datetimes are naive UTC ISO strings; parse them as UTC explicitly. */

export function parseUtc(iso: string): Date {
  return new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return parseUtc(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diffMs = Date.now() - parseUtc(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return fmtDateTime(iso);
}

export function fmtNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toPrecision(4).replace(/\.?0+$/, "");
}
