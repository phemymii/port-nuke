// Port discovery for macOS / Linux / other POSIX systems.
//
// Strategy (first tool that works wins):
//   1. lsof   - present by default on macOS, common on Linux. Parsed via the
//               machine-readable `-F` output so command names with spaces and
//               differing column layouts don't break us.
//   2. ss     - modern Linux (iproute2). Used when lsof is unavailable.
//   3. netstat- last-resort fallback on Linux.
//
// Each returns a normalized list of matches:
//   { pid, command, user, protocol, address, port, state }

import { run, isMissingCommand } from "../exec.js";

function portFromAddress(addr) {
  if (!addr) return null;
  // For connection rows lsof prints "local->remote"; the local side is ours.
  let a = addr;
  const arrow = a.indexOf("->");
  if (arrow !== -1) a = a.slice(0, arrow);
  // Handles "*:3000", "127.0.0.1:3000", "[::1]:3000", "[::]:3000".
  const idx = a.lastIndexOf(":");
  if (idx === -1) return null;
  const port = Number(a.slice(idx + 1));
  return Number.isInteger(port) ? port : null;
}

// A "server" socket is one that owns a port: a TCP listener or a UDP socket.
// Outbound/ESTABLISHED TCP connections are excluded so we never mistake (or
// kill) a browser talking to a remote :443 for a local service on port 443.
function isServerSocket(m) {
  if (m.protocol === "udp") return true;
  if (m.protocol === "tcp") return m.state === "LISTEN";
  return false;
}

// ---- lsof --------------------------------------------------------------

function parseLsof(stdout) {
  const matches = [];
  let pid = null;
  let command = "";
  let user = "";
  let file = null;

  const flush = () => {
    if (file && file.address) {
      const port = portFromAddress(file.address);
      if (port !== null) {
        matches.push({
          pid,
          command,
          user,
          protocol: file.protocol || "",
          address: file.address,
          port,
          state: file.state || "",
        });
      }
    }
    file = null;
  };

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "") continue;
    const tag = line[0];
    const value = line.slice(1);
    switch (tag) {
      case "p": // new process
        flush();
        pid = Number(value);
        command = "";
        user = "";
        break;
      case "c":
        command = value;
        break;
      case "L":
        user = value;
        break;
      case "f": // new file descriptor within the current process
        flush();
        file = { protocol: "", address: "", state: "" };
        break;
      case "P":
        if (file) file.protocol = value.toLowerCase();
        break;
      case "n":
        if (file) file.address = value;
        break;
      case "T":
        // TCP info, e.g. "ST=LISTEN". Only the state is useful here.
        if (file && value.startsWith("ST=")) file.state = value.slice(3);
        break;
      default:
        break;
    }
  }
  flush();
  return matches;
}

async function viaLsof() {
  // -n no host resolution, -P no port-name resolution, -i all internet files.
  // -F selects machine-readable fields: p(pid) c(command) L(login) P(proto)
  // n(name/address) T(tcp info).
  const { stdout, error } = await run("lsof", ["-nP", "-i", "-FpcnPTL"]);
  if (error && isMissingCommand(error)) return null; // signal: try next tool
  return parseLsof(stdout).filter(isServerSocket);
}

// ---- ss (iproute2) -----------------------------------------------------

function parseSs(stdout) {
  const matches = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    const cols = line.split(/\s+/);
    // Netid State Recv-Q Send-Q Local:Port Peer:Port [Process]
    const protocol = (cols[0] || "").toLowerCase();
    const state = cols[1] || "";
    const local = cols[4] || "";
    const port = portFromAddress(local);
    if (port === null) continue;
    const procField = cols.slice(6).join(" ");
    const pidMatch = procField.match(/pid=(\d+)/);
    const nameMatch = procField.match(/"([^"]+)"/);
    if (!pidMatch) continue;
    matches.push({
      pid: Number(pidMatch[1]),
      command: nameMatch ? nameMatch[1] : "",
      user: "",
      protocol: protocol.startsWith("udp") ? "udp" : "tcp",
      address: local,
      port,
      state: state === "UNCONN" ? "" : state,
    });
  }
  return matches;
}

async function viaSs() {
  const { stdout, error } = await run("ss", ["-tulpnH"]);
  if (error && isMissingCommand(error)) return null;
  // Some ss builds still print a header even with -H; parseSs tolerates it.
  return parseSs(stdout);
}

// ---- netstat -----------------------------------------------------------

function parseNetstatLinux(stdout) {
  const matches = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || /^(Active|Proto)/i.test(line)) continue;
    const cols = line.split(/\s+/);
    const protocol = (cols[0] || "").toLowerCase();
    if (!protocol.startsWith("tcp") && !protocol.startsWith("udp")) continue;
    const local = cols[3] || "";
    const port = portFromAddress(local);
    if (port === null) continue;
    // The PID/Program column looks like "12345/node"; locate it anywhere.
    const progToken = cols.find((c) => /^\d+\/.+/.test(c));
    if (!progToken) continue;
    const slash = progToken.indexOf("/");
    matches.push({
      pid: Number(progToken.slice(0, slash)),
      command: progToken.slice(slash + 1),
      user: "",
      protocol: protocol.startsWith("udp") ? "udp" : "tcp",
      address: local,
      port,
      state: protocol.startsWith("udp") ? "" : cols[5] || "",
    });
  }
  return matches;
}

async function viaNetstat() {
  const { stdout, error } = await run("netstat", ["-tulpn"]);
  if (error && isMissingCommand(error)) return null;
  return parseNetstatLinux(stdout);
}

/** Return every TCP-listening / UDP-bound socket with an owning PID. */
export async function listAll() {
  const chain = [viaLsof, viaSs, viaNetstat];
  const failures = [];
  for (const finder of chain) {
    try {
      const result = await finder();
      if (result !== null) return result;
      failures.push(`${finder.name}: not installed`);
    } catch (err) {
      failures.push(`${finder.name}: ${err.message}`);
    }
  }
  const err = new Error(
    "Could not inspect ports: none of lsof, ss or netstat are available.\n  " +
      failures.join("\n  ")
  );
  err.code = "NO_PORT_TOOL";
  throw err;
}

export const _internal = { parseLsof, parseSs, parseNetstatLinux, portFromAddress };
export default { listAll };
