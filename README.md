# Biolaris Media

🇬🇧 English | [🇮🇹 Italiano](README.it.md)

Biolaris Media is an open-source desktop app for converting and compressing media files on your computer. It is built with Tauri 2, React, TypeScript, and Rust, and includes the tools it needs to work with your files.

> **Project status:** Biolaris Media is still in development. You can convert and compress audio and video files. Image and PDF tools, resizing, and PDF extraction and merging are still being connected. The audio quality setting does not change codec settings yet.

## Requirements

- Node.js and npm
- Rust and Cargo
- The Tauri 2 development prerequisites for your platform
- An internet connection for the first download of the media tool binaries

See the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for your operating system.

## Run in development

1. Clone the repository and install dependencies:

   ```sh
   git clone https://github.com/bispitalieri/biolaris-media.git
   cd biolaris-media
   npm ci
   ```

2. Download the binaries for the current system:

   ```sh
   npm run binaries:download
   ```

   The script gets the tools from their distributors: FFmpeg/FFprobe and Poppler from the public [unpins](https://unpins.org/) catalog, ImageMagick from its platform distributor, and libvips from its upstream archive on Windows. It checks published SHA-256 hashes and saves the files in `src-tauri/binaries/<target-triple>/`. Add `-- --force` if you need to download them again. Build on the same kind of system as your target platform.

3. Start the desktop app:

   ```sh
   npm run dev:tauri
   ```

To build only the web frontend, run `npm run build`. The `dev:tauri` and `tauri:build` commands download the tools automatically if they are not already on your system.

## Runtime binaries and distribution

Before Tauri starts, `binaries:stage` puts the tools for your system in `src-tauri/binaries/runtime-current/`. Tauri packages that folder, which keeps binaries for other platforms out of your build. The folder contains FFmpeg/FFprobe, ImageMagick (`magick`/`convert`), and Poppler (`pdftoppm`/`pdfunite`). Aliases that share an executable are created in the per-user cache at startup rather than bundled as duplicate files. Windows builds also include libvips. There are no official standalone libvips builds for macOS or Linux, and the app does not currently use the `vips` command, so those builds leave it out.

The `dev:tauri` and `tauri:build` commands download and prepare the tools automatically. GitHub Actions builds a separate package for Windows, macOS, and Linux, with only the binaries needed by that platform. The Linux build uses an x86_64 ImageMagick AppImage. The standalone macOS package comes from an external distributor and needs macOS Sonoma or later. You can find download sources, versions, and checksums in `runtime-manifest.json`.

To publish a release, push a stable semantic version tag such as `v1.2.3`. GitHub Actions uses the tag as the app version, builds signed updater packages, stages the release as a draft, and publishes it only after the Windows, macOS, and Linux packages and `latest.json` are all uploaded. To update every checked-in app-version location locally, run `npm run version:update -- 1.2.3`.

The updater public key is configured in `src-tauri/tauri.conf.json`; the matching private key and password must be available to GitHub Actions as `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep the private key out of the repository and do not replace the key pair casually: existing installations trust the configured public key. If preparing a new repository, generate a key with `npm run tauri -- signer generate -w ~/.tauri/biolaris.key`, configure its public key and store its private key/password as Actions secrets. Tagged builds fail early if the signing configuration is missing.

Apple signing and notarization are optional. Without Apple secrets, tagged releases include unsigned macOS builds; macOS may show a security warning, and users may need to Control-click the app and choose **Open**. Later, add `APPLE_CERTIFICATE` (base64-encoded Developer ID `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password), and `APPLE_TEAM_ID` as GitHub Actions secrets. Once `APPLE_CERTIFICATE` is present, the release workflow requires the full set, imports the certificate, and signs and notarizes the macOS app.

The published `v0.1.0` predates the updater. Users on that version must manually install the first updater-enabled release once; later updater-enabled versions can update through the app.

Before sharing or distributing the app, check the licenses for FFmpeg and its codecs, ImageMagick, libvips, Poppler, and the libraries they include. The AGPL license for this repository does not cover those separate programs.

## Contributing

Found a bug or have an idea? Let us know through [GitHub Issues](https://github.com/bispitalieri/biolaris-media/issues). For a larger change, open an issue first so we can discuss the approach. See the [contribution guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before getting started.

## Security

If you find a security vulnerability, follow the instructions in [SECURITY.md](SECURITY.md). Please do not post details that could be used to exploit it in a public issue.

## License

Biolaris Media's code is available under the [GNU Affero General Public License v3.0](LICENSE).
