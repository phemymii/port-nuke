import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { once } from "node:events";

import { find, nuke, getListeners } from "../src/index.js";
import { isAlive } from "../src/killer.js";

// Grab a currently-free TCP port from the OS.
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Spawn a child node process that listens on `port` and prints READY.
async function spawnListener(port) {
  const code = `
    const net = require('net');
    const s = net.createServer(() => {});
    s.listen(${port}, () => process.stdout.write('READY'));
  `;
  const child = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "ignore"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("listener did not become ready")), 5000);
    child.stdout.on("data", (d) => {
      if (String(d).includes("READY")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("error", reject);
  });
  return child;
}

test("find() locates a real listening process", async () => {
  const port = await getFreePort();
  const child = await spawnListener(port);
  try {
    const matches = await find(port);
    assert.ok(matches.length >= 1, "expected at least one match");
    assert.ok(matches.some((m) => m.pid === child.pid), "expected our child's PID");
    assert.ok(matches.every((m) => m.port === port));
  } finally {
    if (isAlive(child.pid)) child.kill("SIGKILL");
  }
});

test("nuke() dry-run reports the target but does not kill it", async () => {
  const port = await getFreePort();
  const child = await spawnListener(port);
  try {
    const report = await nuke(port, { dryRun: true });
    assert.equal(report.dryRun, true);
    assert.ok(report.targets.some((t) => t.pid === child.pid));
    assert.equal(report.killed, 0);
    assert.ok(isAlive(child.pid), "child should still be alive after dry run");
  } finally {
    if (isAlive(child.pid)) child.kill("SIGKILL");
  }
});

test("nuke() actually frees the port", async () => {
  const port = await getFreePort();
  const child = await spawnListener(port);
  const exited = once(child, "exit");

  const report = await nuke(port);
  assert.equal(report.failed, 0, JSON.stringify(report.targets));
  assert.ok(report.killed >= 1);
  assert.ok(report.freed.includes(port));

  await exited; // process really terminated
  assert.equal(isAlive(child.pid), false);

  // Port is now reusable.
  const reuse = net.createServer();
  reuse.listen(port, "127.0.0.1");
  await once(reuse, "listening");
  await new Promise((r) => reuse.close(r));
});

test("nuke() on a free port reports nothing to do", async () => {
  const port = await getFreePort();
  const report = await nuke(port);
  assert.equal(report.found.length, 0);
  assert.equal(report.killed, 0);
  assert.deepEqual(report.notInUse, [port]);
});

test("getListeners() returns an array of well-formed matches", async () => {
  const port = await getFreePort();
  const child = await spawnListener(port);
  try {
    const listeners = await getListeners();
    assert.ok(Array.isArray(listeners));
    const mine = listeners.find((m) => m.port === port);
    assert.ok(mine, "our port should show up in the global listing");
    assert.equal(typeof mine.pid, "number");
    assert.equal(typeof mine.port, "number");
  } finally {
    if (isAlive(child.pid)) child.kill("SIGKILL");
  }
});
