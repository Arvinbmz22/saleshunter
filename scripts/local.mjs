#!/usr/bin/env node
/**
 * Local runner for AdminExt AI Lead Finder.
 *
 * Cross-platform (Windows / Linux / macOS) one-command startup:
 *
 *   npm run local          # dev server with the labeled mock provider
 *   npm run local:prod     # production server (run `npm run build` first)
 *   npm run local:lan      # dev server bound to 0.0.0.0 (reachable from LAN)
 *
 * Environment overrides:
 *   PORT                 port (default 3500)
 *   HOST                 bind host (default 127.0.0.1, or 0.0.0.0 for local:lan)
 *   SEARCH_PROVIDER      mock | tavily | serper | brave   (default mock)
 *   AI_PROVIDER          mock | openai | off              (default mock)
 *   SEARCH_BUDGET        max queries per search           (default 80)
 *
 * Any other variable from .env.local / .env is passed through untouched.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

const mode = args.includes("--prod") ? "start" : "dev";
const bindLan = args.includes("--lan");
const port = process.env.PORT ?? "3500";
const host = process.env.HOST ?? (bindLan ? "0.0.0.0" : "127.0.0.1");

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

const env = {
  ...process.env,
  SEARCH_PROVIDER: process.env.SEARCH_PROVIDER ?? "mock",
  AI_PROVIDER: process.env.AI_PROVIDER ?? "mock",
  PORT: port,
};

const childArgs = [nextBin, mode, "-H", host, "-p", port, ...args.filter((a) => !a.startsWith("--"))];

console.log("─".repeat(64));
console.log(`AdminExt AI Lead Finder — ${mode === "start" ? "production" : "development"} server`);
console.log(`  URL   : http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
console.log(`  Search: ${env.SEARCH_PROVIDER}${env.SEARCH_PROVIDER === "mock" ? "  (labeled mock data — not real search)" : ""}`);
console.log(`  AI    : ${env.AI_PROVIDER}`);
console.log("─".repeat(64));

const child = spawn(process.execPath, childArgs, { stdio: "inherit", env, cwd: root });

child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
