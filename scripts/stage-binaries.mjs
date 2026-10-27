#!/usr/bin/env node

import {cp, mkdir, readFile, rm, stat} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binariesDir = join(projectRoot, "src-tauri", "binaries");
const stageRoot = join(binariesDir, "runtime-current");

function nativeTarget() {
  for (const args of [["--print", "host-tuple"], ["-vV"]]) {
    const result = spawnSync("rustc", args, {encoding: "utf8", stdio: "pipe", windowsHide: true});
    if (result.error || result.status !== 0) continue;
    const output = result.stdout.trim();
    const target = args[0] === "-vV" ? output.match(/^host:\s*(\S+)$/m)?.[1] : output;
    if (target) return target;
  }

  const targets = {
    "win32/x64": "x86_64-pc-windows-msvc",
    "darwin/x64": "x86_64-apple-darwin",
    "darwin/arm64": "aarch64-apple-darwin",
    "linux/x64": "x86_64-unknown-linux-gnu",
    "linux/arm64": "aarch64-unknown-linux-gnu",
  };
  const target = targets[process.platform + "/" + process.arch];
  if (!target) throw new Error("Piattaforma/architettura non supportata: " + process.platform + "/" + process.arch + ".");
  return target;
}

async function main() {
  const target = nativeTarget();
  const sourceDir = join(binariesDir, target);
  const manifestPath = join(sourceDir, "runtime-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 2 || manifest.targetTriple !== target || !Array.isArray(manifest.tools)) {
    throw new Error("Manifest runtime non valido per il target " + target + ".");
  }

  const sourceStats = await stat(sourceDir);
  if (!sourceStats.isDirectory()) throw new Error("Runtime non trovato: " + sourceDir);
  await rm(stageRoot, {recursive: true, force: true});
  await mkdir(stageRoot, {recursive: true});
  await cp(sourceDir, join(stageRoot, target), {recursive: true, force: false});
  console.log("Preparato solo il runtime " + target + " in " + join(stageRoot, target) + ".");
}

main().catch((error) => {
  console.error("Preparazione binari non riuscita: " + error.message);
  process.exitCode = 1;
});
