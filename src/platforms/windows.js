// Port discovery for Windows via `netstat -ano`, enriched with process names
// from `tasklist`.
//
// Normalized match shape (same as the unix module):
//   { pid, command, user, protocol, address, port, state }

import { run } from "../exec.js";

function portFromAddress(addr) {
  if (!addr) return null;
  const idx = addr.lastIndexOf(":");
  if (idx === -1) return null;
  const port = Number(addr.slice(idx + 1));
  return Number.isInteger(port) ? port : null;
}

export function parseNetstat(stdout) {
  const rows = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    const cols = line.split(/\s+/);
    const protoRaw = (cols[0] || "").toUpperCase();
    if (protoRaw !== "TCP" && protoRaw !== "UDP") continue;

    const local = cols[1] || "";
    const port = portFromAddress(local);
    if (port === null) continue;

    // TCP:  Proto Local Foreign State PID
    // UDP:  Proto Local Foreign PID          (no State column)
    const pid = Number(cols[cols.length - 1]);
    if (!Number.isInteger(pid)) continue;
    const state = protoRaw === "TCP" ? cols[3] || "" : "";

    rows.push({
      pid,
      command: "",
      user: "",
      protocol: protoRaw.toLowerCase(),
      address: local,
      port,
      state,
    });
  }
  return rows;
}

export function parseTasklist(stdout) {
  // CSV rows: "Image Name","PID","Session Name","Session#","Mem Usage"
  const map = new Map();
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    const fields = line.split('","').map((f) => f.replace(/^"|"$/g, ""));
    if (fields.length < 2) continue;
    const name = fields[0];
    const pid = Number(fields[1]);
    if (Number.isInteger(pid)) map.set(pid, name);
  }
  return map;
}

async function tasklistNames() {
  const { stdout, error } = await run("tasklist", ["/FO", "CSV", "/NH"]);
  if (error) return new Map();
  return parseTasklist(stdout);
}

export async function listAll() {
  const { stdout, error } = await run("netstat", ["-ano"]);
  if (error && error.code === "ENOENT") {
    const err = new Error("Could not inspect ports: `netstat` is unavailable.");
    err.code = "NO_PORT_TOOL";
    throw err;
  }
  const rows = parseNetstat(stdout);
  if (rows.length === 0) return rows;
  const names = await tasklistNames();
  for (const row of rows) {
    const name = names.get(row.pid);
    if (name) row.command = name;
  }
  return rows;
}

export const _internal = { parseNetstat, parseTasklist, portFromAddress };
export default { listAll };
