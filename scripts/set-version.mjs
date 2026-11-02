import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {readFile, writeFile} from "node:fs/promises";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = (path) => resolve(projectRoot, path);
const tag = process.argv[2] ?? "";
const version = tag.replace(/^v/, "");

if (!/^((0|[1-9]\d*)\.){2}(0|[1-9]\d*)$/.test(version)) {
  throw new Error("Expected a stable semantic version tag such as v1.2.3.");
}

let packageJsonContent = await readFile(projectPath("package.json"), "utf8");
let packageLockContent = await readFile(projectPath("package-lock.json"), "utf8");
let tauriConfigContent = await readFile(projectPath("src-tauri/tauri.conf.json"), "utf8");
let cargoToml = await readFile(projectPath("src-tauri/Cargo.toml"), "utf8");

const packageJson = JSON.parse(packageJsonContent);
const packageLock = JSON.parse(packageLockContent);
const tauriConfig = JSON.parse(tauriConfigContent);

if (!/^\[package\]\n[\s\S]*?^version = "[^"]+"/m.test(cargoToml)) {
  throw new Error("Could not find the Rust package version in src-tauri/Cargo.toml.");
}

const updateJsonVersion = (content, currentVersion) => {
  if (currentVersion === version) return content;

  const updated = content.replace(
    `"version": "${currentVersion}"`,
    `"version": "${version}"`,
  );
  if (updated === content) throw new Error("Could not find a package version to update.");
  return updated;
};

packageJsonContent = updateJsonVersion(packageJsonContent, packageJson.version);
packageLockContent = updateJsonVersion(packageLockContent, packageLock.version);
packageLockContent = updateJsonVersion(packageLockContent, packageLock.packages[""].version);
tauriConfigContent = updateJsonVersion(tauriConfigContent, tauriConfig.version);
cargoToml = cargoToml.replace(
  /^(\[package\]\n[\s\S]*?^version = ")[^"]+(")/m,
  (_match, prefix, suffix) => `${prefix}${version}${suffix}`,
);

await Promise.all([
  writeFile(projectPath("package.json"), packageJsonContent),
  writeFile(projectPath("package-lock.json"), packageLockContent),
  writeFile(projectPath("src-tauri/tauri.conf.json"), tauriConfigContent),
  writeFile(projectPath("src-tauri/Cargo.toml"), cargoToml),
]);

console.log(`Set application version to ${version}.`);
