// Tiny zero-dependency ANSI color helper.
// Respects NO_COLOR (https://no-color.org), FORCE_COLOR and non-TTY output.

const forceColor = process.env.FORCE_COLOR;
const noColor = process.env.NO_COLOR;

function supportsColor() {
  if (noColor) return false;
  if (forceColor === "0" || forceColor === "false") return false;
  if (forceColor) return true;
  if (process.env.TERM === "dumb") return false;
  // Only colorize when stdout is a real terminal.
  return Boolean(process.stdout && process.stdout.isTTY);
}

const enabled = supportsColor();

function wrap(open, close) {
  return (str) => (enabled ? `\u001b[${open}m${str}\u001b[${close}m` : String(str));
}

export const colors = {
  enabled,
  reset: wrap(0, 0),
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  underline: wrap(4, 24),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  grey: wrap(90, 39),
};

export default colors;
