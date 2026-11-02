/** Neutralise spreadsheet formulas (=, +, -, @ after optional whitespace/control chars). */
export const safeCell = (s: string) => (/^[\s\x00-\x1f]*[=+\-@]/.test(s) ? "'" + s : s);
export const toCsv = (rows: Record<string, unknown>[], cols: string[]) =>
  [cols.join(","), ...rows.map(r => cols.map(c => `"${safeCell(String(r[c] ?? "")).replace(/"/g, '""')}"`).join(","))].join("\n");
export function download(name: string, data: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
