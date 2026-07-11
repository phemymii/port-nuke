import { execFile } from "node:child_process";

/**
 * Run a command and resolve with { stdout, stderr, code, error }.
 * Never rejects: callers inspect the result instead of catching. This keeps
 * the cross-platform discovery logic simple (a missing tool is just an empty
 * result, not a thrown exception that aborts the fallback chain).
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ timeout?: number, maxBuffer?: number }} [opts]
 */
export function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        timeout: opts.timeout ?? 10000,
        maxBuffer: opts.maxBuffer ?? 1024 * 1024 * 8,
        windowsHide: true,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ? String(stdout) : "",
          stderr: stderr ? String(stderr) : "",
          code: error && typeof error.code === "number" ? error.code : error ? 1 : 0,
          error: error || null,
        });
      }
    );
  });
}

/** True when the given error means the executable was not found on PATH. */
export function isMissingCommand(error) {
  return Boolean(error) && (error.code === "ENOENT" || error.code === 127);
}

export default run;
