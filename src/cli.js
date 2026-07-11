import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { colors } from "./colors.js";
import { renderTable } from "./table.js";
import { parsePorts, PortParseError } from "./parse-ports.js";
import { getListeners, find, nuke } from "./index.js";

function readVersion() {
  try {
    const url = new URL("../package.json", import.meta.url);
    return JSON.parse(readFileSync(url, "utf8")).version;
  } catch {
    return "0.0.0";
  }
}

const OPTIONS = {
  list: { type: "boolean", short: "l" },
  force: { type: "boolean", short: "f" },
  yes: { type: "boolean", short: "y" },
  "dry-run": { type: "boolean", short: "n" },
  interactive: { type: "boolean", short: "i" },
  scan: { type: "boolean", short: "s" },
  json: { type: "boolean" },
  quiet: { type: "boolean", short: "q" },
  verbose: { type: "boolean", short: "v" },
  tcp: { type: "boolean" },
  udp: { type: "boolean" },
  tree: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
};

function helpText() {
  const b = colors.bold;
  const c = colors.cyan;
  const d = colors.dim;
  return `
${b("port-nuke")} ${d("— find and kill whatever is holding a port hostage")}

${b("USAGE")}
  ${c("npx port-nuke")} <ports...> [options]

${b("PORTS")}
  3000                a single port
  3000 8080 5000      several ports
  3000-3010           an inclusive range
  :3000               a leading colon is fine (paste straight from a URL)

${b("ACTIONS")}
  ${c("(default)")}           kill the process(es) on the given port(s)
  -l, --list          show what's on the port(s) without killing anything
  -s, --scan          list every listening port on this machine
  -i, --interactive   pick which listeners to kill from a menu

${b("MODIFIERS")}
  -f, --force         skip the graceful signal, kill immediately (SIGKILL / /F)
  -n, --dry-run       show what would be killed, but don't kill it
  -y, --yes           don't ask for confirmation (interactive mode)
      --tcp           only match TCP sockets
      --udp           only match UDP sockets
      --tree          (windows) also kill child processes
      --json          machine-readable JSON output
  -q, --quiet         only print errors
  -v, --verbose       print extra detail
  -h, --help          show this help
      --version       show the version

${b("EXAMPLES")}
  ${d("# The classic: free up port 3000")}
  npx port-nuke 3000

  ${d("# Nuke a whole dev stack at once")}
  npx port-nuke 3000 5173 8080

  ${d("# See what's on a port before killing it")}
  npx port-nuke 3000 --list

  ${d("# What's listening on this machine?")}
  npx port-nuke --scan
`;
}

function resolveProtocol(values) {
  if (values.tcp && !values.udp) return "tcp";
  if (values.udp && !values.tcp) return "udp";
  return "all";
}

function matchRows(matches) {
  return matches.map((m) => [
    colors.yellow(m.pid),
    m.command || colors.dim("?"),
    colors.cyan(m.port),
    m.protocol || colors.dim("-"),
    m.address || colors.dim("-"),
    m.state ? colors.dim(m.state) : colors.dim("-"),
  ]);
}

function printMatches(matches) {
  const table = renderTable(
    ["PID", "COMMAND", "PORT", "PROTO", "ADDRESS", "STATE"],
    matchRows(matches)
  );
  stdout.write(table + "\n");
}

function log(quiet, msg) {
  if (!quiet) stdout.write(msg + "\n");
}

// ---- action: scan / list-all -----------------------------------------

async function actionScan(opts) {
  const listeners = await getListeners({ protocol: opts.protocol });
  if (opts.json) {
    stdout.write(JSON.stringify(listeners, null, 2) + "\n");
    return 0;
  }
  if (listeners.length === 0) {
    log(opts.quiet, colors.dim("No listening ports found."));
    return 0;
  }
  const sorted = [...listeners].sort((a, b) => a.port - b.port);
  log(opts.quiet, colors.bold(`${sorted.length} listening socket(s):\n`));
  printMatches(sorted);
  return 0;
}

// ---- action: list (specific ports) -----------------------------------

async function actionList(ports, opts) {
  const matches = await find(ports, { protocol: opts.protocol });
  if (opts.json) {
    stdout.write(JSON.stringify(matches, null, 2) + "\n");
    return 0;
  }
  if (matches.length === 0) {
    log(
      opts.quiet,
      colors.green(`Nothing is using port${ports.length > 1 ? "s" : ""} ${ports.join(", ")}.`)
    );
    return 0;
  }
  printMatches(matches);
  return 0;
}

// ---- action: nuke -----------------------------------------------------

function printNukeResult(report, opts) {
  const { quiet } = opts;
  if (report.found.length === 0) {
    log(
      quiet,
      colors.green(
        `\u2713 Nothing to nuke — port${report.requested.length > 1 ? "s" : ""} ${report.requested.join(", ")} ${report.requested.length > 1 ? "are" : "is"} already free.`
      )
    );
    return;
  }

  for (const t of report.targets) {
    const label = `${colors.bold(t.command || "process")} ${colors.dim("(pid " + t.pid + ")")} on port ${t.ports.map((p) => colors.cyan(p)).join(", ")}`;
    if (t.skipped) {
      log(quiet, `${colors.yellow("• skipped")} ${label} — ${t.reason}`);
    } else if (report.dryRun) {
      log(quiet, `${colors.yellow("• would kill")} ${label}`);
    } else if (t.killed) {
      const how = t.forced ? colors.dim(" (forced)") : "";
      log(quiet, `${colors.green("\u2713 killed")} ${label}${how}`);
    } else {
      log(quiet, `${colors.red("\u2717 failed")} ${label} — ${t.reason || "unknown error"}`);
    }
  }

  if (!quiet) {
    if (report.dryRun) {
      stdout.write(colors.dim(`\nDry run: ${report.targets.length} process(es) would be killed. Nothing was touched.\n`));
    } else if (report.freed.length) {
      stdout.write(colors.green(`\nFreed port(s): ${report.freed.join(", ")}\n`));
    }
  }
}

async function actionNuke(ports, opts) {
  const report = await nuke(ports, {
    protocol: opts.protocol,
    force: opts.force,
    tree: opts.tree,
    dryRun: opts.dryRun,
  });

  if (opts.json) {
    stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    printNukeResult(report, opts);
  }
  return report.failed > 0 ? 1 : 0;
}

// ---- action: interactive ---------------------------------------------

async function actionInteractive(opts) {
  const listeners = await getListeners({ protocol: opts.protocol });
  if (listeners.length === 0) {
    log(opts.quiet, colors.dim("No listening ports found — nothing to do."));
    return 0;
  }
  const sorted = [...listeners].sort((a, b) => a.port - b.port);

  const rows = sorted.map((m, i) => [
    colors.dim(`[${i + 1}]`),
    colors.yellow(m.pid),
    m.command || colors.dim("?"),
    colors.cyan(m.port),
    m.protocol || colors.dim("-"),
    m.address || colors.dim("-"),
  ]);
  stdout.write(
    renderTable(["#", "PID", "COMMAND", "PORT", "PROTO", "ADDRESS"], rows) + "\n\n"
  );

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (
      await rl.question(
        colors.bold("Which to kill? ") +
          colors.dim("(numbers/ports, comma-separated, 'all', or blank to cancel): ")
      )
    ).trim();

    if (answer === "") {
      log(opts.quiet, colors.dim("Cancelled."));
      return 0;
    }

    let chosenPorts;
    if (answer.toLowerCase() === "all") {
      chosenPorts = sorted.map((m) => m.port);
    } else {
      const tokens = answer.split(/[,\s]+/).filter(Boolean);
      const ports = new Set();
      for (const tok of tokens) {
        const idx = Number(tok);
        // A small number is treated as a menu index; larger values as ports.
        if (Number.isInteger(idx) && idx >= 1 && idx <= sorted.length) {
          ports.add(sorted[idx - 1].port);
        } else {
          for (const p of parsePorts(tok)) ports.add(p);
        }
      }
      chosenPorts = [...ports];
    }

    if (chosenPorts.length === 0) {
      log(opts.quiet, colors.yellow("No valid selection — nothing killed."));
      return 0;
    }

    if (!opts.yes && !opts.dryRun) {
      const confirm = (
        await rl.question(
          colors.bold(`Kill process(es) on ${chosenPorts.join(", ")}? `) + colors.dim("(y/N) ")
        )
      ).trim().toLowerCase();
      if (confirm !== "y" && confirm !== "yes") {
        log(opts.quiet, colors.dim("Cancelled."));
        return 0;
      }
    }

    rl.close();
    return actionNuke(chosenPorts, opts);
  } finally {
    rl.close();
  }
}

// ---- entrypoint -------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    stdout.write(colors.red(`Error: ${err.message}\n`));
    stdout.write(colors.dim("Run `port-nuke --help` for usage.\n"));
    return 2;
  }

  const { values, positionals } = parsed;

  if (values.version) {
    stdout.write(readVersion() + "\n");
    return 0;
  }
  if (values.help) {
    stdout.write(helpText() + "\n");
    return 0;
  }

  const opts = {
    protocol: resolveProtocol(values),
    force: Boolean(values.force),
    tree: Boolean(values.tree),
    dryRun: Boolean(values["dry-run"]),
    yes: Boolean(values.yes),
    json: Boolean(values.json),
    quiet: Boolean(values.quiet),
    verbose: Boolean(values.verbose),
  };

  try {
    if (values.interactive) return await actionInteractive(opts);
    if (values.scan) return await actionScan(opts);

    if (positionals.length === 0) {
      // No ports and no explicit action: show help rather than guess.
      stdout.write(helpText() + "\n");
      return 0;
    }

    let ports;
    try {
      ports = parsePorts(positionals);
    } catch (err) {
      if (err instanceof PortParseError) {
        stdout.write(colors.red(`Error: ${err.message}\n`));
        return 2;
      }
      throw err;
    }

    if (ports.length === 0) {
      stdout.write(colors.red("Error: no valid ports given.\n"));
      return 2;
    }

    if (values.list) return await actionList(ports, opts);
    return await actionNuke(ports, opts);
  } catch (err) {
    if (err && err.code === "NO_PORT_TOOL") {
      stdout.write(colors.red(`Error: ${err.message}\n`));
      return 3;
    }
    stdout.write(colors.red(`Unexpected error: ${err && err.message ? err.message : err}\n`));
    if (opts.verbose && err && err.stack) stdout.write(colors.dim(err.stack + "\n"));
    return 1;
  }
}

export default main;
