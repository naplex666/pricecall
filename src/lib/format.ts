/** Small display formatters (pure). */

export function formatUsd(n: number, digits = 2): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPct(price01: number): string {
  return `${(price01 * 100).toFixed(1)}%`;
}

/** "1h 23m" / "4d 2h" / "45s" style countdown. */
export function formatTimeLeft(secs: number): string {
  if (secs <= 0) return "expired";
  const d = Math.floor(secs / 86_400);
  const h = Math.floor((secs % 86_400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatDateTime(tsSecs: number): string {
  return new Date(tsSecs * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** pm-AMM market `name` is stored as number[] (bytes). */
export function decodeName(name: number[] | string): string {
  if (typeof name === "string") return name;
  return new TextDecoder().decode(new Uint8Array(name)).replace(/\0+$/, "");
}
