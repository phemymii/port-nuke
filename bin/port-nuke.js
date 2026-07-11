#!/usr/bin/env node
import { main } from "../src/cli.js";

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = typeof code === "number" ? code : 0;
  })
  .catch((err) => {
    // Last-resort guard: main() handles expected errors itself.
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  });
