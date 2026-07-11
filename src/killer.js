// Cross-platform process termination.
//   - Windows: `taskkill` (supports /F force and /T child-tree).
//   - POSIX:   process.kill() with SIGTERM (graceful) or SIGKILL (force).

import { run } from "./exec.js";

const isWindows = process.platform === "win32";

/** Is a process with this PID currently alive? Uses the no-op signal 0. */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM => it exists but we can't signal it; ESRCH => it's gone.
    return err.code === "EPERM";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function killWindows(pid, { force, tree }) {
  const args = ["/PID", String(pid)];
  if (tree) args.push("/T");
  if (force) args.push("/F");
  const { code, stderr, error } = await run("taskkill", args);
  if (code === 0) return { ok: true };
  // 128 == process not found (already dead) -> treat as success.
  if (/not found|128/i.test(stderr) || code === 128) return { ok: true };
  return { ok: false, reason: (stderr || (error && error.message) || "taskkill failed").trim() };
}

function killPosix(pid, { force, signal }) {
  const sig = signal || (force ? "SIGKILL" : "SIGTERM");
  try {
    process.kill(pid, sig);
    return { ok: true };
  } catch (err) {
    if (err.code === "ESRCH") return { ok: true }; // already gone
    if (err.code === "EPERM") {
      return { ok: false, reason: "permission denied (try running with sudo)" };
    }
    return { ok: false, reason: err.message };
  }
}

/**
 * Kill a single PID once.
 * @param {number} pid
 * @param {{ force?: boolean, tree?: boolean, signal?: string }} [opts]
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function killPid(pid, opts = {}) {
  if (isWindows) return killWindows(pid, opts);
  return killPosix(pid, opts);
}

/**
 * Kill a PID and confirm it actually died, optionally escalating from a
 * graceful signal to a forceful one.
 *
 * @param {number} pid
 * @param {{
 *   force?: boolean,       // start with a forceful kill immediately
 *   tree?: boolean,        // (windows) kill child process tree
 *   signal?: string,       // (posix) override the graceful signal
 *   escalate?: boolean,    // if still alive after graceful, force kill
 *   graceMs?: number,      // how long to wait before escalating/verifying
 * }} [opts]
 */
export async function terminate(pid, opts = {}) {
  const { force = false, tree = false, signal, escalate = true, graceMs = 500 } = opts;

  const first = await killPid(pid, { force, tree, signal });
  if (!first.ok) {
    return { pid, killed: false, forced: force, reason: first.reason };
  }

  // Give the process a moment to exit, then verify.
  await sleep(Math.min(graceMs, 100));
  let deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return { pid, killed: true, forced: force };
    await sleep(50);
  }

  if (!isAlive(pid)) return { pid, killed: true, forced: force };

  // Still alive after a graceful attempt: escalate to force once.
  if (!force && escalate) {
    const second = await killPid(pid, { force: true, tree });
    if (!second.ok) return { pid, killed: false, forced: true, reason: second.reason };
    deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
      if (!isAlive(pid)) return { pid, killed: true, forced: true };
      await sleep(50);
    }
  }

  return isAlive(pid)
    ? { pid, killed: false, forced: true, reason: "process survived kill signal" }
    : { pid, killed: true, forced: true };
}

export default { killPid, terminate, isAlive };
