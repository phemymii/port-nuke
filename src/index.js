// port-nuke — programmatic API.
//
// Everything is Promise-based and free of side effects unless you call nuke().
//
//   import { find, getListeners, nuke, parsePorts } from "port-nuke";
//
//   await find(3000);                 // who is on port 3000?
//   await getListeners();             // every listening port
//   await nuke([3000, 8080]);         // free those ports
//   await nuke("3000-3005", { dryRun: true });

import unix from "./platforms/unix.js";
import windows from "./platforms/windows.js";
import { terminate, isAlive } from "./killer.js";
import { parsePorts } from "./parse-ports.js";

const platform = process.platform === "win32" ? windows : unix;

/**
 * @typedef {Object} Match
 * @property {number} pid
 * @property {string} command
 * @property {string} user
 * @property {"tcp"|"udp"|""} protocol
 * @property {string} address
 * @property {number} port
 * @property {string} state
 */

function filterByProtocol(matches, protocol) {
  if (!protocol || protocol === "all") return matches;
  return matches.filter((m) => m.protocol === protocol);
}

// Collapse rows that are identical to the user (same process, port, protocol,
// address and state) — e.g. separate IPv4/IPv6 file descriptors of one socket.
function dedupe(matches) {
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    const key = `${m.pid}|${m.port}|${m.protocol}|${m.address}|${m.state}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/**
 * List every listening TCP / bound UDP socket that has an owning process.
 * @param {{ protocol?: "tcp"|"udp"|"all" }} [opts]
 * @returns {Promise<Match[]>}
 */
export async function getListeners(opts = {}) {
  const all = await platform.listAll();
  return dedupe(filterByProtocol(all, opts.protocol));
}

/**
 * Find the processes bound to one or more ports.
 * @param {string|number|Array<string|number>} ports
 * @param {{ protocol?: "tcp"|"udp"|"all" }} [opts]
 * @returns {Promise<Match[]>}
 */
export async function find(ports, opts = {}) {
  const wanted = new Set(parsePorts(ports));
  if (wanted.size === 0) return [];
  const all = await getListeners(opts);
  return all.filter((m) => wanted.has(m.port));
}

/** Group flat matches into one entry per PID (a process can hold many ports). */
function groupByPid(matches) {
  const byPid = new Map();
  for (const m of matches) {
    let entry = byPid.get(m.pid);
    if (!entry) {
      entry = {
        pid: m.pid,
        command: m.command || "",
        user: m.user || "",
        ports: new Set(),
        protocols: new Set(),
        addresses: new Set(),
      };
      byPid.set(m.pid, entry);
    }
    if (!entry.command && m.command) entry.command = m.command;
    entry.ports.add(m.port);
    if (m.protocol) entry.protocols.add(m.protocol);
    if (m.address) entry.addresses.add(m.address);
  }
  return [...byPid.values()].map((e) => ({
    pid: e.pid,
    command: e.command,
    user: e.user,
    ports: [...e.ports].sort((a, b) => a - b),
    protocols: [...e.protocols].sort(),
    addresses: [...e.addresses],
  }));
}

/**
 * Find and terminate the processes holding the given ports.
 *
 * @param {string|number|Array<string|number>} ports
 * @param {{
 *   protocol?: "tcp"|"udp"|"all",
 *   force?: boolean,        // SIGKILL / taskkill /F straight away
 *   tree?: boolean,         // (windows) also kill child processes
 *   escalate?: boolean,     // escalate graceful -> force if needed (default true)
 *   graceMs?: number,       // wait window for the process to exit
 *   dryRun?: boolean,       // find + plan but don't actually kill
 *   skipSelf?: boolean,     // never kill the current process (default true)
 * }} [opts]
 * @returns {Promise<{
 *   requested: number[],
 *   found: Match[],
 *   targets: Array<Object>,
 *   killed: number,
 *   failed: number,
 *   freed: number[],
 *   notInUse: number[],
 *   dryRun: boolean,
 * }>}
 */
export async function nuke(ports, opts = {}) {
  const {
    protocol = "all",
    force = false,
    tree = false,
    escalate = true,
    graceMs = 500,
    dryRun = false,
    skipSelf = true,
  } = opts;

  const requested = parsePorts(ports);
  const found = await find(requested, { protocol });
  const targets = groupByPid(found);

  const usedPorts = new Set(found.map((m) => m.port));
  const notInUse = requested.filter((p) => !usedPorts.has(p));

  let killed = 0;
  let failed = 0;
  const freed = new Set();

  for (const target of targets) {
    if (skipSelf && target.pid === process.pid) {
      target.skipped = true;
      target.reason = "refusing to kill port-nuke itself";
      continue;
    }

    if (dryRun) {
      target.killed = false;
      target.dryRun = true;
      continue;
    }

    const result = await terminate(target.pid, { force, tree, escalate, graceMs });
    target.killed = result.killed;
    target.forced = result.forced;
    if (result.reason) target.reason = result.reason;

    if (result.killed) {
      killed += 1;
      for (const p of target.ports) freed.add(p);
    } else {
      failed += 1;
    }
  }

  return {
    requested,
    found,
    targets,
    killed,
    failed,
    freed: [...freed].sort((a, b) => a - b),
    notInUse,
    dryRun,
  };
}

export { parsePorts, terminate, isAlive };
export default { find, getListeners, nuke, parsePorts, terminate, isAlive };
