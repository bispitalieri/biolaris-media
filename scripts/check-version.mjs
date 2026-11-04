import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {readFile} from "node:fs/promises";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = (path) => resolve(projectRoot, path);
const releaseTag = process.env.RELEASE_VERSION ?? process.argv[2] ?? "";
const version = releaseTag.replace(/^v/, "");

if (!/^((0|[1-9]\d*)\.){2}(0|[1-9]\d*)$/.test(version)) {
  throw new Error("Expected a stable semantic version tag such as v1.2.3.");
}

const [packageJson, packageLock, tauriConfig, cargoToml, cargoLock] = await Promise.all([
  readFile(projectPath("package.json"), "utf8").then(JSON.parse),
  readFile(projectPath("package-lock.json"), "utf8").then(JSON.parse),
  readFile(projectPath("src-tauri/tauri.conf.json"), "utf8").then(JSON.parse),
  readFile(projectPath("src-tauri/Cargo.toml"), "utf8"),
  readFile(projectPath("src-tauri/Cargo.lock"), "utf8"),
]);

const versions = [
  ["package.json", packageJson.version],
  ["package-lock.json", packageLock.version],
  ["package-lock.json root package", packageLock.packages[""].version],
  ["src-tauri/tauri.conf.json", tauriConfig.version],
];

const cargoTomlVersion = cargoToml.match(/^\[package\]\r?\n[\s\S]*?^version = "([^"]+)"/m)?.[1];
const cargoLockVersion = cargoLock.match(
  /^\[\[package\]\]\r?\nname = "biolaris_media"\r?\nversion = "([^"]+)"/m,
)?.[1];
versions.push(
  ["src-tauri/Cargo.toml", cargoTomlVersion],
  ["src-tauri/Cargo.lock", cargoLockVersion],
);

const mismatches = versions.filter(([, currentVersion]) => currentVersion !== version);
if (mismatches.length > 0) {
  throw new Error(
    `Release tag ${releaseTag} does not match the checked-in application version ${version}:\n` +
      mismatches.map(([file, currentVersion]) => `- ${file}: ${currentVersion ?? "not found"}`).join("\n") +
      "\nRun `npm run version:update -- " + version + "` locally, then commit and push the updated version.",
  );
}

console.log(`Checked-in application version matches ${releaseTag}.`);
