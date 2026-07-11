# port-nuke

> Find and kill whatever is holding a port hostage — on macOS, Windows and Linux.

You know the error:

```
Error: listen EADDRINUSE: address already in use :::3000
```

A dev server crashed but left the port open, and now you're googling `lsof`
flags again. `port-nuke` does it in one command:

```bash
npx port-nuke 3000
```

```
✓ killed node (pid 41234) on port 3000

Freed port(s): 3000
```

- **Cross-platform** — one command that works the same on macOS, Windows and Linux.
- **Zero dependencies** — pure Node.js built-ins. Nothing to audit, nothing to bloat your `node_modules`.
- **Safe by default** — sends a graceful `SIGTERM` first and only escalates to a
  forceful kill if the process refuses to die. Never kills itself.
- **Precise** — only targets real port *owners* (TCP listeners + UDP sockets),
  never your browser's outbound connections to a remote `:443`.
- **Scriptable** — `--json` output and a Promise-based API for programmatic use.

## Usage

```bash
# The classic: free up port 3000
npx port-nuke 3000

# Nuke a whole dev stack at once
npx port-nuke 3000 5173 8080

# A range of ports
npx port-nuke 3000-3010

# Paste straight from a URL — the leading colon/host is fine
npx port-nuke :3000
npx port-nuke localhost:3000
```

Install it globally if you use it a lot:

```bash
npm install -g port-nuke
port-nuke 3000
# `nuke-port` is provided as an alias too
```

### Look before you leap

```bash
# What is on the port? (doesn't kill anything)
port-nuke 3000 --list

# What would be killed? (dry run)
port-nuke 3000 --dry-run

# What's listening on this whole machine?
port-nuke --scan

# Pick from a menu
port-nuke --interactive
```

## Options

| Flag | Alias | Description |
| --- | --- | --- |
| `--list` | `-l` | Show what's on the port(s) without killing anything |
| `--scan` | `-s` | List every listening port on this machine |
| `--interactive` | `-i` | Pick which listeners to kill from a menu |
| `--force` | `-f` | Skip the graceful signal, kill immediately (`SIGKILL` / `taskkill /F`) |
| `--dry-run` | `-n` | Show what would be killed, but don't kill it |
| `--yes` | `-y` | Skip the confirmation prompt in interactive mode |
| `--tcp` | | Only match TCP sockets |
| `--udp` | | Only match UDP sockets |
| `--tree` | | (Windows) also kill child processes |
| `--json` | | Machine-readable JSON output |
| `--quiet` | `-q` | Only print errors |
| `--verbose` | `-v` | Print extra detail |
| `--help` | `-h` | Show help |
| `--version` | | Show the version |

## Programmatic API

`port-nuke` is also a library. Everything is Promise-based.

```js
import { find, getListeners, nuke, parsePorts } from "port-nuke";

// Who is on port 3000?
const matches = await find(3000);
// -> [{ pid, command, user, protocol, address, port, state }]

// Every listening port on the machine
const listeners = await getListeners();

// Free one or more ports
const report = await nuke([3000, 8080]);
console.log(report.freed); // -> [3000, 8080]

// Preview without killing
await nuke("3000-3005", { dryRun: true });

// Parse user input into a clean list of port numbers
parsePorts(["3000-3002", ":8080"]); // -> [3000, 3001, 3002, 8080]
```

### `nuke(ports, options)`

Returns a report:

```jsonc
{
  "requested": [3000],
  "found": [/* raw matches */],
  "targets": [
    { "pid": 41234, "command": "node", "ports": [3000], "protocols": ["tcp"], "killed": true, "forced": false }
  ],
  "killed": 1,
  "failed": 0,
  "freed": [3000],
  "notInUse": [],
  "dryRun": false
}
```

Options:

| Option | Default | Description |
| --- | --- | --- |
| `protocol` | `"all"` | `"tcp"`, `"udp"` or `"all"` |
| `force` | `false` | Use a forceful kill immediately |
| `escalate` | `true` | Escalate graceful → force if the process survives |
| `graceMs` | `500` | How long to wait for the process to exit |
| `tree` | `false` | (Windows) also kill child processes |
| `dryRun` | `false` | Find and plan, but don't kill |
| `skipSelf` | `true` | Never kill the current process |

## How it works

Under the hood `port-nuke` shells out to the right native tool for the platform
and normalizes the output:

| Platform | Discovery | Termination |
| --- | --- | --- |
| macOS | `lsof` | `SIGTERM` → `SIGKILL` |
| Linux | `lsof` → `ss` → `netstat` (whichever exists) | `SIGTERM` → `SIGKILL` |
| Windows | `netstat -ano` + `tasklist` | `taskkill` (`/F`, `/T`) |

It sends a graceful signal first so well-behaved servers can shut down cleanly,
then verifies the process actually exited and escalates to a forceful kill if
needed.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success (killed, or nothing to kill) |
| `1` | One or more processes could not be killed |
| `2` | Bad arguments / invalid port |
| `3` | No supported discovery tool found on this system |

## Requirements

- Node.js `>= 16.17.0`

## License

MIT
