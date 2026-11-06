# Development and builds

[English](DEVELOPMENT.md) | [Italiano](DEVELOPMENT.it.md)

## Prerequisites

- Node.js (the CI workflow uses Node.js 24) and npm
- Rust stable and Cargo
- Tauri 2 native development prerequisites for the host OS
- Internet access to fetch the platform-specific runtime binaries during desktop setup

The release workflow lists the Linux packages used for CI builds in [`.github/workflows/release.yml`](../workflows/release.yml). Build the app on a supported host: Windows x64, macOS Intel/Apple silicon, or Linux x64.

## Install and run

```sh
git clone https://github.com/bispitalieri/biolaris-media.git
cd biolaris-media
npm ci
npm run dev:tauri
```

`dev:tauri` downloads the matching runtime, stages it for Tauri, and starts the desktop development app. To run the runtime setup separately, use:

```sh
npm run binaries:download
npm run binaries:stage
```

Build only the frontend with `npm run build`. Create a desktop bundle for the current host with `npm run tauri:build`.

## Runtime tools

The downloader first looks for a matching, checksummed runtime bundle in the `runtime-latest` release of [bispitalieri/biolaris-runtime](https://github.com/bispitalieri/biolaris-runtime/releases). If a compatible bundle is unavailable, the script downloads and verifies its configured tools individually. The runtime includes FFmpeg/FFprobe, ImageMagick, Poppler utilities, and `yt-dlp`. Windows runtime bundles also include libvips, which the current app does not invoke.

The app stages only host-platform binaries under `src-tauri/binaries/runtime-current/` before Tauri development/build commands. Do not commit downloaded runtime binaries.

## Architecture overview

- The React/TypeScript interface exposes each tool as a screen and calls the Rust backend through Tauri commands.
- Rust validates file paths and requests, then runs queued jobs and emits progress events to the UI.
- FFmpeg handles audio/video operations and common raster conversions; ImageMagick handles image conversions and cropping; Poppler renders PDF page previews. Rust libraries implement PDF editing, image-to-PDF generation, vector tracing, and icon asset generation.
- Background removal runs in the frontend using ONNX Runtime WebAssembly. It fetches the pinned BiRefNet Lite model on first use, then performs inference locally on the CPU.

For code changes, follow the repository's [contribution guide](../CONTRIBUTING.md). The CI workflow runs `npm ci` and `npm run build`; Rust changes should also be checked with:

```sh
cargo check --manifest-path src-tauri/Cargo.toml
```
