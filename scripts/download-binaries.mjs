#!/usr/bin/env node

import {createHash} from "node:crypto";
import {createWriteStream} from "node:fs";
import {chmod, copyFile, link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile} from "node:fs/promises";
import {dirname, basename, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {Readable, Transform} from "node:stream";
import {pipeline} from "node:stream/promises";
import {spawnSync} from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binariesDir = join(projectRoot, "src-tauri", "binaries");
const maxDownloadBytes = Number(process.env.BIOLARIS_BINARY_MAX_BYTES || 400 * 1024 * 1024);
const requiredTools = ["ffmpeg", "ffprobe", "magick", "convert", "pdftoppm", "pdfunite"];
const versionArgs = new Map([
  ["ffmpeg", ["-version"]],
  ["ffprobe", ["-version"]],
  ["magick", ["-version"]],
  ["convert", ["-version"]],
  ["vips", ["--version"]],
  ["pdftoppm", ["-v"]],
  ["pdfunite", ["-v"]],
]);

function printHelp() {
  console.log(`Uso: node scripts/download-binaries.mjs [--target <rust-target-triple>] [--force]

Scarica separatamente il runtime del sistema host e lo conserva in
src-tauri/binaries/<target-triple>. La build Tauri prepara poi solo il target
corrente in src-tauri/binaries/runtime-current/.

Opzioni:
  --target <triple>  Specifica il target Rust; deve corrispondere al runner.
  --force            Scarica nuovamente e sostituisce il runtime corrente.
  --help             Mostra questo messaggio.

Non usa release GitHub di Biolaris. FFmpeg/FFprobe e Poppler sono scaricati
dal catalogo pubblico unpins; ImageMagick e vips usano le distribuzioni dei
rispettivi progetti. vips non ha una build standalone ufficiale per macOS/Linux.`);
}

function parseArgs(args) {
  let target;
  let force = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--target") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Manca il valore di --target.");
      target = value;
      index += 1;
    } else {
      throw new Error("Opzione sconosciuta: " + arg);
    }
  }
  return {target, force};
}

function nativeTarget() {
  const rust = spawnSync("rustc", ["--print", "host-tuple"], {encoding: "utf8", stdio: "pipe", windowsHide: true});
  if (!rust.error && rust.status === 0 && rust.stdout.trim()) return rust.stdout.trim();

  const verbose = spawnSync("rustc", ["-vV"], {encoding: "utf8", stdio: "pipe", windowsHide: true});
  if (!verbose.error && verbose.status === 0) {
    const host = verbose.stdout.match(/^host:\s*(\S+)$/m)?.[1];
    if (host) return host;
  }

  const map = {
    "win32/x64": "x86_64-pc-windows-msvc",
    "darwin/x64": "x86_64-apple-darwin",
    "darwin/arm64": "aarch64-apple-darwin",
    "linux/x64": "x86_64-unknown-linux-gnu",
    "linux/arm64": "aarch64-unknown-linux-gnu",
  };
  const target = map[process.platform + "/" + process.arch];
  if (!target) throw new Error("Piattaforma/architettura non supportata: " + process.platform + "/" + process.arch + ".");
  return target;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    windowsHide: true,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  });
  if (result.error) throw new Error("Impossibile eseguire " + command + ": " + result.error.message);
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "").trim();
    throw new Error(command + " è terminato con codice " + result.status + (details ? ": " + details : "."));
  }
  return result.stdout || "";
}

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "biolaris-binary-downloader",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fetchResponse(url, headers = {}) {
  const response = await fetch(url, {headers: {...githubHeaders(), ...headers}, redirect: "follow"});
  if (!response.ok) {
    const details = (await response.text()).slice(0, 300);
    throw new Error("Download " + url + " non riuscito (" + response.status + " " + response.statusText + "): " + details);
  }
  return response;
}

async function fetchJson(url) {
  return (await fetchResponse(url)).json();
}

function parseSha256(text) {
  const match = text.match(/\b([a-f0-9]{64})\b/i);
  if (!match) throw new Error("Risposta checksum priva di SHA-256 valido.");
  return match[1].toLowerCase();
}

async function downloadFile(url, destination, expectedSha256, maxBytes = maxDownloadBytes) {
  const response = await fetchResponse(url, {Accept: "application/octet-stream"});
  if (!response.body) throw new Error("Risposta senza contenuto: " + url);
  const advertisedBytes = Number(response.headers.get("content-length") || 0);
  if (advertisedBytes > maxBytes) throw new Error("Il file supera il limite di " + maxBytes + " byte: " + url);

  const hash = createHash("sha256");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) return callback(new Error("Il download supera il limite di " + maxBytes + " byte: " + url));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(destination, {flags: "w"}));
  const sha256 = hash.digest("hex");
  if (expectedSha256 && sha256 !== expectedSha256.toLowerCase()) {
    throw new Error("SHA-256 non corrispondente per " + basename(destination) + ": atteso " + expectedSha256 + ", ricevuto " + sha256 + ".");
  }
  return {sha256, bytes};
}

async function getGithubAsset(ownerRepo, namePattern, label) {
  const release = await fetchJson("https://api.github.com/repos/" + ownerRepo + "/releases/latest");
  if (release.draft || release.prerelease) throw new Error("La release pubblica di " + label + " non è stabile.");
  const asset = release.assets?.find((item) => namePattern.test(item.name));
  if (!asset) throw new Error("La release pubblica di " + label + " non contiene un asset compatibile con " + namePattern + ".");

  let sha256 = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toLowerCase();
  if (!sha256) {
    const checksum = release.assets.find((item) => item.name === asset.name + ".sha256");
    if (checksum) sha256 = parseSha256(await (await fetchResponse(checksum.browser_download_url, {Accept: "application/octet-stream"})).text());
  }
  if (!sha256) throw new Error("La release di " + label + " non pubblica un checksum SHA-256 per " + asset.name + ".");
  return {release, asset, sha256};
}

function assertSupportedHost() {
  const supported = (process.platform === "win32" && process.arch === "x64")
    || (process.platform === "darwin" && ["x64", "arm64"].includes(process.arch))
    || (process.platform === "linux" && process.arch === "x64");
  if (!supported) {
    throw new Error("I distributori standalone configurati coprono Windows x64, macOS Intel/Apple Silicon e Linux x86_64. Host non supportato: " + process.platform + "/" + process.arch + ".");
  }
}

async function installUnpinsPackages(scratch, binDir, sourceRecords) {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const architecture = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
  if (os === "windows" && architecture !== "x86_64") throw new Error("unpins non pubblica ancora build Windows ARM64 per questi pacchetti.");
  const executableName = os === "windows" ? "unpin.exe" : "unpin";
  const unpinUrl = os === "windows"
    ? "https://unpins.org/unpin-x86_64-windows.exe"
    : "https://unpins.org/unpin-" + architecture + "-" + os;
  const unpinPath = join(scratch, executableName);
  const checksumText = await (await fetchResponse(unpinUrl + ".sha256", {Accept: "text/plain"})).text();
  const checksum = parseSha256(checksumText);
  const downloaded = await downloadFile(unpinUrl, unpinPath, checksum, 30 * 1024 * 1024);
  if (process.platform !== "win32") await chmod(unpinPath, 0o755);

  const isolatedHome = join(scratch, "home");
  const localAppData = join(scratch, "local-app-data");
  const appData = join(scratch, "app-data");
  const env = {
    ...process.env,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    LOCALAPPDATA: localAppData,
    APPDATA: appData,
    XDG_CONFIG_HOME: join(isolatedHome, ".config"),
    XDG_DATA_HOME: join(isolatedHome, ".local", "share"),
    XDG_STATE_HOME: join(isolatedHome, ".local", "state"),
  };
  await mkdir(isolatedHome, {recursive: true});
  await mkdir(localAppData, {recursive: true});
  await mkdir(appData, {recursive: true});

  console.log("Scarico separatamente FFmpeg/FFprobe e Poppler dal catalogo pubblico unpins...");
  run(unpinPath, ["install", "--yes", "ffmpeg", "poppler-utils"], {env, stdio: "inherit"});

  const installedAliases = [];
  for (const tool of ["ffmpeg", "ffprobe", "pdftoppm", "pdfunite"]) {
    const source = await findNamedFile(scratch, tool + (process.platform === "win32" ? ".exe" : ""));
    if (!source) throw new Error("unpin ha completato l'installazione ma non ha creato il comando " + tool + ".");
    const destination = join(binDir, tool + (process.platform === "win32" ? ".exe" : ""));
    const metadata = await stat(source);
    const sharedBinary = installedAliases.find((item) => item.metadata.dev === metadata.dev && item.metadata.ino === metadata.ino);
    if (sharedBinary) await makeAlias(sharedBinary.destination, destination);
    else {
      await copyFile(source, destination);
      installedAliases.push({metadata, destination});
    }
    if (process.platform !== "win32") await chmod(destination, 0o755);
  }
  sourceRecords.push({provider: "unpins.org", packages: ["unpins/ffmpeg", "unpins/poppler-utils"], unpinSha256: downloaded.sha256});
}

async function walkFiles(root, visitor, depth = 0) {
  if (depth > 16) return;
  let entries;
  try {
    entries = await readdir(root, {withFileTypes: true});
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await walkFiles(path, visitor, depth + 1);
    else await visitor(path, entry);
  }
}

async function findNamedFile(root, expectedName) {
  const expected = expectedName.toLowerCase();
  const matches = [];
  await walkFiles(root, async (path, entry) => {
    if (entry.name.toLowerCase() !== expected) return;
    const metadata = await stat(path).catch(() => undefined);
    if (metadata?.isFile() && metadata.size > 0) matches.push(path);
  });
  matches.sort((left, right) => left.length - right.length);
  return matches[0];
}

async function extractArchive(archivePath, destination, scratch, kind = "tar") {
  await mkdir(destination, {recursive: true});
  if (kind === "7z") {
    const sevenZip = await getGithubAsset("ip7z/7zip", /\/7zr\.exe$|^7zr\.exe$/i, "7-Zip");
    const extractor = join(scratch, "7zr.exe");
    await downloadFile(sevenZip.asset.browser_download_url, extractor, sevenZip.sha256, 20 * 1024 * 1024);
    run(extractor, ["x", "-y", archivePath, "-o" + destination]);
  } else {
    const listing = run("tar", ["-tf", archivePath], {maxBuffer: 32 * 1024 * 1024});
    for (const entry of listing.split(/\r?\n/).filter(Boolean)) {
      const normalized = entry.replace(/^\.\//, "").replace(/\\/g, "/");
      if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.split("/").some((part) => part === "..")) {
        throw new Error("Percorso non sicuro nell'archivio: " + entry);
      }
    }
    run("tar", ["-xf", archivePath, "-C", destination]);
  }
}

async function makeAlias(source, destination) {
  await rm(destination, {force: true});
  if (process.platform === "win32") {
    try {
      await link(source, destination);
    } catch {
      await copyFile(source, destination);
    }
  } else {
    await symlink(basename(source), destination);
  }
}

async function installImageMagick(scratch, prefix, binDir, sourceRecords) {
  if (process.platform === "linux") {
    if (process.arch !== "x64") {
      throw new Error("ImageMagick non pubblica un AppImage standalone ARM64; il target Linux supportato dal downloader è x86_64.");
    }
    const {release, asset, sha256} = await getGithubAsset("ImageMagick/ImageMagick", /-gcc-x86_64\.AppImage$/i, "ImageMagick Linux");
    const destination = join(binDir, "magick");
    console.log("Scarico ImageMagick " + release.tag_name + " da GitHub Releases...");
    const downloaded = await downloadFile(asset.browser_download_url, destination, sha256, 150 * 1024 * 1024);
    await chmod(destination, 0o755);
    sourceRecords.push({provider: "ImageMagick/ImageMagick", version: release.tag_name, asset: asset.name, sha256: downloaded.sha256});
    await makeAlias(destination, join(binDir, "convert"));
    return;
  }

  if (process.platform === "win32") {
    if (process.arch !== "x64") throw new Error("ImageMagick portable disponibile qui solo per Windows x64.");
    const {release, asset, sha256} = await getGithubAsset("ImageMagick/ImageMagick", /-portable-Q16-x64\.7z$/i, "ImageMagick Windows");
    const archive = join(scratch, asset.name);
    console.log("Scarico ImageMagick " + release.tag_name + " da GitHub Releases...");
    const downloaded = await downloadFile(asset.browser_download_url, archive, sha256, 100 * 1024 * 1024);
    const extracted = join(scratch, "imagemagick");
    await extractArchive(archive, extracted, scratch, "7z");
    const executable = await findNamedFile(extracted, "magick.exe");
    if (!executable) throw new Error("L'archivio ImageMagick non contiene magick.exe.");
    let sourceRoot = dirname(executable);
    if (basename(sourceRoot).toLowerCase() === "bin") sourceRoot = dirname(sourceRoot);
    await copyImageMagickRuntime(sourceRoot, prefix, binDir);
    const convert = await findNamedFile(extracted, "convert.exe");
    if (convert) await copyFile(convert, join(binDir, "convert.exe"));
    else await makeAlias(join(binDir, "magick.exe"), join(binDir, "convert.exe"));
    sourceRecords.push({provider: "ImageMagick/ImageMagick", version: release.tag_name, asset: asset.name, sha256: downloaded.sha256});
    return;
  }

  const pageUrl = "https://mendelson.org/imagemagick.html";
  const html = await (await fetchResponse(pageUrl, {Accept: "text/html"})).text();
  const links = [...html.matchAll(/href\s*=\s*["']([^"']+\.dmg(?:\?[^"']*)?)["']/gi)].map((match) => new URL(match[1], pageUrl).toString());
  const dmgUrl = links.find((url) => /ImageMagick/i.test(url));
  if (!dmgUrl) throw new Error("Non trovo il DMG standalone ImageMagick sulla pagina pubblica del distributore macOS.");

  const dmgPath = join(scratch, "imagemagick.dmg");
  console.log("Scarico il DMG standalone ImageMagick per macOS...");
  const downloaded = await downloadFile(dmgUrl, dmgPath, undefined, 150 * 1024 * 1024);
  const mountPoint = join(scratch, "imagemagick-mounted");
  await mkdir(mountPoint, {recursive: true});
  run("hdiutil", ["verify", dmgPath]);
  run("hdiutil", ["attach", dmgPath, "-readonly", "-nobrowse", "-mountpoint", mountPoint]);
  try {
    const executable = await findNamedFile(mountPoint, "magick");
    if (!executable) throw new Error("Il DMG ImageMagick non contiene l'eseguibile magick.");
    const destination = join(binDir, "magick");
    await copyFile(executable, destination);
    await chmod(destination, 0o755);
  } finally {
    run("hdiutil", ["detach", mountPoint, "-quiet"]);
  }
  await makeAlias(join(binDir, "magick"), join(binDir, "convert"));
  sourceRecords.push({provider: pageUrl, asset: dmgUrl, sha256: downloaded.sha256});
}

async function copyImageMagickRuntime(sourceRoot, prefix, binDir) {
  await walkFiles(sourceRoot, async (source, entry) => {
    const lower = entry.name.toLowerCase();
    const relative = source.slice(sourceRoot.length + 1);
    const extension = lower.slice(lower.lastIndexOf("."));
    const isMainExecutable = lower === "magick.exe" || lower === "convert.exe";
    const isRuntimeFile = isMainExecutable || extension === ".dll" || extension === ".xml" || [".mgk", ".dat", ".ttf", ".otf"].includes(extension);
    if (!isRuntimeFile) return;

    let destination;
    if (isMainExecutable) destination = join(binDir, entry.name);
    else if (extension === ".dll" && !relative.includes("modules")) destination = join(binDir, entry.name);
    else destination = join(prefix, relative);
    await mkdir(dirname(destination), {recursive: true});
    await copyFile(source, destination);
  });
  const magickPath = join(binDir, "magick.exe");
  if (!(await stat(magickPath).catch(() => undefined))) {
    const source = await findNamedFile(sourceRoot, "magick.exe");
    if (!source) throw new Error("Non riesco a preparare magick.exe dal pacchetto ImageMagick.");
    await copyFile(source, magickPath);
  }
}

async function installVipsWindows(scratch, prefix, binDir, sourceRecords) {
  const {release, asset, sha256} = await getGithubAsset("libvips/build-win64-mxe", /^vips-dev-x64-web-.*-static\.zip$/i, "libvips Windows");
  const archive = join(scratch, asset.name);
  console.log("Scarico libvips " + release.tag_name + " dal progetto upstream...");
  const downloaded = await downloadFile(asset.browser_download_url, archive, sha256, 100 * 1024 * 1024);
  const extracted = join(scratch, "vips");
  await extractArchive(archive, extracted, scratch);
  const executable = await findNamedFile(extracted, "vips.exe");
  if (!executable) throw new Error("L'archivio libvips non contiene vips.exe.");
  const sourceRoot = dirname(dirname(executable));
  await copyVipsRuntime(sourceRoot, prefix, binDir);
  sourceRecords.push({provider: "libvips/build-win64-mxe", version: release.tag_name, asset: asset.name, sha256: downloaded.sha256});
}

async function copyVipsRuntime(sourceRoot, prefix, binDir) {
  await walkFiles(sourceRoot, async (source, entry) => {
    const lower = entry.name.toLowerCase();
    const relative = source.slice(sourceRoot.length + 1).replace(/\\/g, "/");
    const relativeLower = relative.toLowerCase();
    const extension = lower.slice(lower.lastIndexOf("."));
    const inBin = relativeLower.split("/")[0] === "bin";
    const inVipsModules = relativeLower.includes("vips-modules");
    const isRuntime = (inBin && (extension === ".dll" || lower === "vips.exe"))
      || (inVipsModules && extension === ".dll")
      || relativeLower.endsWith("gschemas.compiled")
      || relativeLower.includes("share/vips/");
    if (!isRuntime) return;
    const destination = join(prefix, relative);
    await mkdir(dirname(destination), {recursive: true});
    await copyFile(source, destination);
    if (extension === ".dll" && !inBin) {
      await copyFile(source, join(binDir, entry.name));
    }
  });
}

async function smokeCheck(prefix, tools) {
  const binDir = join(prefix, "bin");
  const env = {...process.env};
  env.PATH = [binDir, env.PATH].filter(Boolean).join(process.platform === "win32" ? ";" : ":");
  if (process.platform === "linux") env.APPIMAGE_EXTRACT_AND_RUN = "1";
  if (process.platform === "linux") env.LD_LIBRARY_PATH = [join(prefix, "lib"), join(prefix, "lib64"), env.LD_LIBRARY_PATH].filter(Boolean).join(":");
  if (process.platform === "darwin") {
    env.DYLD_LIBRARY_PATH = [join(prefix, "lib"), join(prefix, "lib64"), env.DYLD_LIBRARY_PATH].filter(Boolean).join(":");
  }
  if (process.platform === "win32") {
    env.MAGICK_HOME = prefix;
    env.VIPSHOME = prefix;
  }

  for (const tool of tools) {
    const executable = join(binDir, tool + (process.platform === "win32" ? ".exe" : ""));
    const metadata = await stat(executable).catch(() => undefined);
    if (!metadata?.isFile() || metadata.size === 0) throw new Error("Manca il binario " + executable + ".");
    if (process.platform !== "win32") await chmod(executable, 0o755);
    try {
      run(executable, versionArgs.get(tool), {env, timeout: 30_000});
    } catch (error) {
      throw new Error("Il binario " + tool + " non si avvia dal bundle: " + error.message);
    }
  }
}

async function verifyExisting(prefix, target) {
  try {
    const manifest = JSON.parse(await readFile(join(prefix, "runtime-manifest.json"), "utf8"));
    const expected = [...requiredTools, ...(target.startsWith("x86_64-pc-windows") ? ["vips"] : [])];
    if (manifest.schemaVersion !== 2 || manifest.targetTriple !== target || !expected.every((tool) => manifest.tools.includes(tool))) return false;
    for (const tool of expected) {
      const file = join(prefix, "bin", tool + (process.platform === "win32" ? ".exe" : ""));
      const metadata = await stat(file);
      if (!metadata.isFile() || metadata.size === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function installRuntime(sourceDir, target, manifest) {
  const destination = join(binariesDir, target);
  const backup = destination + ".backup-" + process.pid;
  let hadPrevious = false;
  if (await stat(destination).catch(() => undefined)) {
    hadPrevious = true;
    await rm(backup, {recursive: true, force: true});
    await rename(destination, backup);
  }

  try {
    await rename(sourceDir, destination);
    await writeFile(join(destination, "runtime-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    await smokeCheck(destination, manifest.tools);
    if (hadPrevious) await rm(backup, {recursive: true, force: true});
  } catch (error) {
    await rm(destination, {recursive: true, force: true});
    if (hadPrevious) await rename(backup, destination).catch(() => {});
    throw error;
  }
}

const {target: requestedTarget, force} = parseArgs(process.argv.slice(2));
let scratch;

try {
  if (!Number.isSafeInteger(maxDownloadBytes) || maxDownloadBytes <= 0) {
    throw new Error("BIOLARIS_BINARY_MAX_BYTES deve essere un intero positivo.");
  }
  const host = nativeTarget();
  const target = requestedTarget ?? host;
  if (target !== host) throw new Error("Il target " + target + " non è quello del sistema host (" + host + "). Esegui il download su un runner nativo.");
  assertSupportedHost();

  const destination = join(binariesDir, target);
  if (!force && await verifyExisting(destination, target)) {
    console.log("I binari standalone per " + target + " sono già presenti.");
    process.exit(0);
  }

  await mkdir(binariesDir, {recursive: true});
  scratch = await mkdtemp(join(binariesDir, ".binary-download-"));
  const stage = join(scratch, "runtime");
  const prefix = stage;
  const binDir = join(prefix, "bin");
  await mkdir(binDir, {recursive: true});
  const sourceRecords = [];

  console.log("Scarico i binari separatamente dai distributori pubblici per " + target + "...");
  await installUnpinsPackages(scratch, binDir, sourceRecords);
  await installImageMagick(scratch, prefix, binDir, sourceRecords);

  const tools = [...requiredTools];
  if (process.platform === "win32") {
    await installVipsWindows(scratch, prefix, binDir, sourceRecords);
    tools.push("vips");
  } else {
    console.warn("vips non scaricato: libvips non pubblica un binario standalone ufficiale per macOS/Linux; questo comando non è usato dal codice applicativo attuale.");
  }

  const manifest = {
    schemaVersion: 2,
    targetTriple: target,
    tools,
    omittedTools: process.platform === "win32" ? [] : ["vips"],
    standalone: true,
    sources: sourceRecords,
    downloadedAt: new Date().toISOString(),
  };
  console.log("Verifico l'avvio dei binari scaricati...");
  await smokeCheck(prefix, tools);
  await installRuntime(stage, target, manifest);

  console.log("Runtime installato: " + destination);
  if (!tools.includes("vips")) console.warn("Nota: il runtime macOS/Linux non include vips; per distribuirlo serve compilarlo staticamente o sostituirlo con un'implementazione nativa.");
} catch (error) {
  console.error("Download binari non riuscito: " + error.message);
  process.exitCode = 1;
} finally {
  if (scratch) await rm(scratch, {recursive: true, force: true}).catch(() => {});
}
