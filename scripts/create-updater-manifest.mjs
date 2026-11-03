import {copyFile, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {join, relative, resolve} from "node:path";

const repository = "bispitalieri/biolaris-media";
const releaseTag = process.env.RELEASE_VERSION ?? "";
const artifactRoot = resolve(process.env.RELEASE_ARTIFACTS_DIR ?? "release-artifacts");

if (!/^v?((0|[1-9]\d*)\.){2}(0|[1-9]\d*)$/.test(releaseTag)) {
  throw new Error("RELEASE_VERSION must be a stable semantic version such as v1.2.3.");
}

const filesBelow = async (directory) => {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }));
  return files.flat();
};

let release;
if (process.env.RELEASE_METADATA_FILE) {
  release = JSON.parse(await readFile(resolve(process.env.RELEASE_METADATA_FILE), "utf8"));
} else {
  const releaseResponse = await fetch(
    `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(releaseTag)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        ...(process.env.GITHUB_TOKEN ? {Authorization: `Bearer ${process.env.GITHUB_TOKEN}`} : {}),
      },
    },
  );
  if (!releaseResponse.ok) {
    throw new Error(`Could not read release notes for ${releaseTag}: GitHub returned ${releaseResponse.status}.`);
  }
  release = await releaseResponse.json();
}
if (release.prerelease) {
  throw new Error("The updater manifest only supports stable releases.");
}
if (release.tag_name && release.tag_name !== releaseTag) {
  throw new Error(`Release metadata tag ${release.tag_name} does not match ${releaseTag}.`);
}

const artifacts = await filesBelow(artifactRoot);
const targetTypes = [
  {target: "darwin-aarch64", folder: "macOS ARM64", suffix: ".app.tar.gz.sig", extension: "app.tar.gz"},
  {target: "darwin-x86_64", folder: "macOS x64", suffix: ".app.tar.gz.sig", extension: "app.tar.gz"},
  {target: "linux-x86_64", folder: "Linux x64", suffix: ".AppImage.sig", extension: "AppImage"},
  {target: "windows-x86_64", folder: "Windows x64", suffix: ".exe.sig", extension: "exe"},
];

const version = releaseTag.replace(/^v/, "");
const updaterDirectory = join(artifactRoot, "updater-assets");
await mkdir(updaterDirectory, {recursive: true});
const platforms = {};

for (const {target, folder, suffix, extension} of targetTypes) {
  const matches = artifacts.filter((path) => path.includes(folder) && path.endsWith(suffix));
  if (matches.length !== 1) {
    throw new Error(`Expected one signed ${target} updater artifact under "${folder}", found ${matches.length}.`);
  }

  const signaturePath = matches[0];
  const packagePath = signaturePath.slice(0, -".sig".length);
  if (!artifacts.includes(packagePath)) {
    throw new Error(`Updater package is missing for ${target}: ${relative(artifactRoot, packagePath)}.`);
  }
  const assetName = `Biolaris-Media_${version}_${target}.${extension}`;
  const signature = (await readFile(signaturePath, "utf8")).trim();
  if (!signature) throw new Error(`Updater signature is empty: ${relative(artifactRoot, signaturePath)}.`);

  await Promise.all([
    copyFile(packagePath, join(updaterDirectory, assetName)),
    writeFile(join(updaterDirectory, `${assetName}.sig`), `${signature}\n`),
  ]);
  platforms[target] = {
    signature,
    url: `https://github.com/${repository}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(assetName)}`,
  };
}

const manifest = {
  version,
  notes: release.body ?? "",
  pub_date: release.published_at ?? new Date().toISOString(),
  platforms,
};
await writeFile(join(artifactRoot, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Created signed updater manifest for ${version} (${Object.keys(platforms).length} platforms).`);
