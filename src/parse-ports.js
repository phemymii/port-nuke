// Parse user-supplied port arguments into a normalized, de-duplicated list.
//
// Supported inputs (any mix, as separate args or comma-joined):
//   3000            -> [3000]
//   :3000           -> [3000]        (leading colon, e.g. copied from a URL)
//   3000,8080       -> [3000, 8080]
//   3000-3005       -> [3000,3001,3002,3003,3004,3005]
//   http://x:3000   -> [3000]        (trailing :port is extracted)

export const MIN_PORT = 1;
export const MAX_PORT = 65535;
const MAX_RANGE_SPAN = 1000; // safety cap so "1-65535" doesn't explode.

export class PortParseError extends Error {
  constructor(message, input) {
    super(message);
    this.name = "PortParseError";
    this.input = input;
  }
}

function toPort(raw, original) {
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new PortParseError(`Invalid port "${original}": not an integer`, original);
  }
  if (n < MIN_PORT || n > MAX_PORT) {
    throw new PortParseError(
      `Invalid port "${original}": must be between ${MIN_PORT} and ${MAX_PORT}`,
      original
    );
  }
  return n;
}

function parseSingleToken(token) {
  const original = token;
  let value = String(token).trim();
  if (value === "") return [];

  // Extract a trailing ":port" from URL-ish strings (e.g. localhost:3000).
  if (value.includes(":")) {
    value = value.slice(value.lastIndexOf(":") + 1);
  }

  // Range: "3000-3005"
  if (value.includes("-")) {
    const [startRaw, endRaw, ...rest] = value.split("-");
    if (rest.length > 0 || startRaw === "" || endRaw === "") {
      throw new PortParseError(`Invalid port range "${original}"`, original);
    }
    const start = toPort(startRaw, original);
    const end = toPort(endRaw, original);
    if (end < start) {
      throw new PortParseError(
        `Invalid port range "${original}": end is before start`,
        original
      );
    }
    if (end - start + 1 > MAX_RANGE_SPAN) {
      throw new PortParseError(
        `Port range "${original}" is too large (max ${MAX_RANGE_SPAN} ports)`,
        original
      );
    }
    const out = [];
    for (let p = start; p <= end; p++) out.push(p);
    return out;
  }

  return [toPort(value, original)];
}

/**
 * @param {string[]} args raw CLI-style port arguments
 * @returns {number[]} sorted, de-duplicated list of valid ports
 */
export function parsePorts(args) {
  const list = Array.isArray(args) ? args : [args];
  const ports = new Set();
  for (const arg of list) {
    // Allow comma-separated groups inside a single argument.
    for (const token of String(arg).split(",")) {
      for (const port of parseSingleToken(token)) {
        ports.add(port);
      }
    }
  }
  return [...ports].sort((a, b) => a - b);
}

export default parsePorts;
