import { test } from "node:test";
import assert from "node:assert/strict";
import { _internal as unix } from "../src/platforms/unix.js";
import { _internal as win } from "../src/platforms/windows.js";

test("unix: parses lsof -F machine output", () => {
  // node listening on 3000 (IPv4 + IPv6), plus a UDP socket for another proc.
  const out = [
    "p12345",
    "cnode",
    "Lfemi",
    "f23",
    "PTCP",
    "n*:3000",
    "TST=LISTEN",
    "f24",
    "PTCP",
    "n[::1]:3000",
    "TST=LISTEN",
    "p678",
    "cControlCe", // a command name is fine even if odd
    "Lfemi",
    "f9",
    "PUDP",
    "n*:5353",
  ].join("\n");

  const matches = unix.parseLsof(out);
  assert.equal(matches.length, 3);

  const tcp = matches.filter((m) => m.protocol === "tcp");
  assert.equal(tcp.length, 2);
  assert.ok(tcp.every((m) => m.pid === 12345 && m.command === "node" && m.port === 3000));
  assert.ok(tcp.every((m) => m.state === "LISTEN"));

  const udp = matches.find((m) => m.protocol === "udp");
  assert.equal(udp.pid, 678);
  assert.equal(udp.port, 5353);
  assert.equal(udp.state, "");
});

test("unix: parses ss -tulpnH output", () => {
  const out = [
    'tcp   LISTEN 0      511          0.0.0.0:3000       0.0.0.0:*    users:(("node",pid=4242,fd=23))',
    'udp   UNCONN 0      0            0.0.0.0:5353       0.0.0.0:*    users:(("avahi",pid=800,fd=12))',
    "tcp   LISTEN 0      128          [::]:8080          [::]:*", // no process info -> skipped
  ].join("\n");

  const matches = unix.parseSs(out);
  assert.equal(matches.length, 2);

  const tcp = matches.find((m) => m.port === 3000);
  assert.equal(tcp.pid, 4242);
  assert.equal(tcp.command, "node");
  assert.equal(tcp.protocol, "tcp");
  assert.equal(tcp.state, "LISTEN");

  const udp = matches.find((m) => m.port === 5353);
  assert.equal(udp.pid, 800);
  assert.equal(udp.protocol, "udp");
  assert.equal(udp.state, ""); // UNCONN normalized away
});

test("unix: parses netstat -tulpn output", () => {
  const out = [
    "Active Internet connections (only servers)",
    "Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name",
    "tcp        0      0 0.0.0.0:3000            0.0.0.0:*               LISTEN      9001/node",
    "udp        0      0 0.0.0.0:5353            0.0.0.0:*                           9050/avahi-daemon",
  ].join("\n");

  const matches = unix.parseNetstatLinux(out);
  assert.equal(matches.length, 2);

  const tcp = matches.find((m) => m.port === 3000);
  assert.equal(tcp.pid, 9001);
  assert.equal(tcp.command, "node");
  assert.equal(tcp.state, "LISTEN");

  const udp = matches.find((m) => m.port === 5353);
  assert.equal(udp.pid, 9050);
  assert.equal(udp.command, "avahi-daemon");
});

test("unix: portFromAddress handles ipv6 and wildcards", () => {
  assert.equal(unix.portFromAddress("*:3000"), 3000);
  assert.equal(unix.portFromAddress("127.0.0.1:8080"), 8080);
  assert.equal(unix.portFromAddress("[::1]:5000"), 5000);
  assert.equal(unix.portFromAddress("[::]:443"), 443);
  assert.equal(unix.portFromAddress("garbage"), null);
});

test("windows: parses netstat -ano output", () => {
  const out = [
    "Active Connections",
    "",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       12345",
    "  TCP    [::]:3000              [::]:0                 LISTENING       12345",
    "  UDP    0.0.0.0:5353           *:*                                    6789",
  ].join("\n");

  const rows = win.parseNetstat(out);
  assert.equal(rows.length, 3);

  const tcp = rows.filter((r) => r.protocol === "tcp");
  assert.ok(tcp.every((r) => r.pid === 12345 && r.port === 3000 && r.state === "LISTENING"));

  const udp = rows.find((r) => r.protocol === "udp");
  assert.equal(udp.pid, 6789);
  assert.equal(udp.port, 5353);
  assert.equal(udp.state, "");
});

test("windows: parses tasklist CSV into a pid->name map", () => {
  const out = [
    '"node.exe","12345","Console","1","55,000 K"',
    '"chrome.exe","6789","Console","1","120,000 K"',
  ].join("\n");
  const map = win.parseTasklist(out);
  assert.equal(map.get(12345), "node.exe");
  assert.equal(map.get(6789), "chrome.exe");
});
