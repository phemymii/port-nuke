import { colors } from "./colors.js";

// Visible length of a string, ignoring ANSI escape codes.
function visibleLength(str) {
  // eslint-disable-next-line no-control-regex
  return String(str).replace(/\u001b\[[0-9;]*m/g, "").length;
}

function pad(str, width) {
  const len = visibleLength(str);
  return len >= width ? str : str + " ".repeat(width - len);
}

/**
 * Render an aligned text table.
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 * @returns {string}
 */
export function renderTable(headers, rows) {
  const widths = headers.map((h, i) => {
    let max = visibleLength(h);
    for (const row of rows) {
      max = Math.max(max, visibleLength(row[i] ?? ""));
    }
    return max;
  });

  const headerLine = headers
    .map((h, i) => colors.bold(pad(h, widths[i])))
    .join("  ");
  const sep = colors.dim(widths.map((w) => "─".repeat(w)).join("  "));
  const body = rows
    .map((row) => row.map((cell, i) => pad(String(cell ?? ""), widths[i])).join("  "))
    .join("\n");

  return rows.length ? `${headerLine}\n${sep}\n${body}` : headerLine;
}

export default renderTable;
