import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePorts, PortParseError, MAX_PORT } from "../src/parse-ports.js";

test("parses a single port", () => {
  assert.deepEqual(parsePorts(["3000"]), [3000]);
  assert.deepEqual(parsePorts("3000"), [3000]);
  assert.deepEqual(parsePorts([3000]), [3000]);
});

test("strips a leading colon and URL host", () => {
  assert.deepEqual(parsePorts([":3000"]), [3000]);
  assert.deepEqual(parsePorts(["localhost:3000"]), [3000]);
  assert.deepEqual(parsePorts(["http://127.0.0.1:8080"]), [8080]);
});

test("parses multiple ports and de-duplicates + sorts", () => {
  assert.deepEqual(parsePorts(["8080", "3000", "3000"]), [3000, 8080]);
});

test("parses comma-separated groups within one arg", () => {
  assert.deepEqual(parsePorts(["3000,8080,5000"]), [3000, 5000, 8080]);
});

test("expands inclusive ranges", () => {
  assert.deepEqual(parsePorts(["3000-3003"]), [3000, 3001, 3002, 3003]);
});

test("merges ranges and singles without duplicates", () => {
  assert.deepEqual(parsePorts(["3000-3002", "3001", "3005"]), [3000, 3001, 3002, 3005]);
});

test("rejects out-of-range ports", () => {
  assert.throws(() => parsePorts(["0"]), PortParseError);
  assert.throws(() => parsePorts([String(MAX_PORT + 1)]), PortParseError);
  assert.throws(() => parsePorts(["-5"]), PortParseError);
});

test("rejects non-numeric ports", () => {
  assert.throws(() => parsePorts(["abc"]), PortParseError);
  assert.throws(() => parsePorts(["30.5"]), PortParseError);
});

test("rejects reversed and oversized ranges", () => {
  assert.throws(() => parsePorts(["3005-3000"]), PortParseError);
  assert.throws(() => parsePorts(["1-5000"]), PortParseError);
});

test("ignores empty tokens", () => {
  assert.deepEqual(parsePorts(["", "3000", ""]), [3000]);
  assert.deepEqual(parsePorts([""]), []);
});
