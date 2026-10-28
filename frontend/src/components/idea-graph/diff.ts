export interface DiffPart {
  text: string;
  kind: "same" | "add" | "remove";
}

const MAX_TOKENS = 60_000; // LCS table safety guard (Uint16 cell values)

/**
 * Word-level diff between two hypothesis bodies (previous -> current).
 * Falls back to showing the whole new text when inputs are very large.
 */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS || a.length * b.length > 4_000_000) {
    return [{ text: after, kind: "add" }];
  }
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("remove", a[i]);
      i += 1;
    } else {
      push("add", b[j]);
      j += 1;
    }
  }
  while (i < n) push("remove", a[i++]);
  while (j < m) push("add", b[j++]);
  return parts;
}
