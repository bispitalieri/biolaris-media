import {readFile, writeFile} from "node:fs/promises";

const tag = process.argv[2] ?? "";
const version = tag.replace(/^v/, "");

if (!/^((0|[1-9]\d*)\.){2}(0|[1-9]\d*)$/.test(version)) {
  throw new Error("Expected a stable semantic version tag such as v1.2.3.");
}

let packageJsonContent = await readFile("package.json", "utf8");
let packageLockContent = await readFile("package-lock.json", "utf8");
let tauriConfigContent = await readFile("src-tauri/tauri.conf.json", "utf8");
let cargoToml = await readFile("src-tauri/Cargo.toml", "utf8");

const packageJson = JSON.parse(packageJsonContent);
const packageLock = JSON.parse(packageLockContent);
const tauriConfig = JSON.parse(tauriConfigContent);

if (!/^\[package\]\n[\s\S]*?^version = "[^"]+"/m.test(cargoToml)) {
  throw new Error("Could not find the Rust package version in src-tauri/Cargo.toml.");
}

const updateJsonVersion = (content, currentVersion) => {
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
  writeFile("package.json", packageJsonContent),
  writeFile("package-lock.json", packageLockContent),
  writeFile("src-tauri/tauri.conf.json", tauriConfigContent),
  writeFile("src-tauri/Cargo.toml", cargoToml),
]);

console.log(`Set application version to ${version}.`);
