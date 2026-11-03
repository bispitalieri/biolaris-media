import {readFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(resolve(projectRoot, "src-tauri/tauri.conf.json"), "utf8"));
const updater = config.plugins?.updater;

if (!updater?.pubkey || updater.pubkey === "REPLACE_WITH_TAURI_SIGNING_PUBLIC_KEY") {
  throw new Error("Set the Tauri updater public key in src-tauri/tauri.conf.json before publishing a release.");
}
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  throw new Error("Set the TAURI_SIGNING_PRIVATE_KEY GitHub Actions secret before publishing a release.");
}
if (process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined) {
  throw new Error("Set the TAURI_SIGNING_PRIVATE_KEY_PASSWORD GitHub Actions secret (an empty value is allowed).");
}
if (process.env.RELEASE_PLATFORM?.startsWith("macOS")) {
  const macOSSecrets = [
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_SIGNING_IDENTITY",
    "KEYCHAIN_PASSWORD",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
  ];
  const missingSecrets = macOSSecrets.filter((name) => !process.env[name]);
  if (missingSecrets.length > 0) {
    throw new Error(`Configure these GitHub Actions secrets before a macOS release: ${missingSecrets.join(", ")}.`);
  }
}
if (!Array.isArray(updater.endpoints) || !updater.endpoints.includes(
  "https://github.com/bispitalieri/biolaris-media/releases/latest/download/latest.json",
)) {
  throw new Error("The Tauri updater endpoint must point to the GitHub latest.json release asset.");
}

console.log("Tauri updater release configuration is ready.");
