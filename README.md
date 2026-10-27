# Biolaris Media

🇬🇧 English | [🇮🇹 Italiano](README.it.md)

Biolaris Media is an open-source desktop app for converting and compressing media files locally on your computer. It is built with Tauri 2, React, TypeScript, and Rust. The app bundles the media tools it uses.

> **Project status:** Biolaris Media is under active development. Audio and video conversion and compression queues are implemented. Image and PDF tools, resizing, and PDF extraction/merging are not connected yet. The audio quality setting is not yet applied to codec parameters.

## Requirements

- Node.js and npm
- Rust and Cargo
- The Tauri 2 development prerequisites for your platform
- An internet connection for the first download of the media tool binaries

See the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for your operating system.

## Run in development

1. Clone the repository and install dependencies:

   ```sh
   git clone https://github.com/bispitalieri/biolaris.git
   cd biolaris
   npm ci
   ```

2. Download the binaries for the current system:

   ```sh
   npm run binaries:download
   ```

   This does not download releases from the Biolaris repository. It downloads FFmpeg/FFprobe and Poppler from the public [unpins](https://unpins.org/) catalog, ImageMagick from its platform distributor, and libvips from its upstream archive on Windows. The script verifies published SHA-256 checksums and stores each runtime in `src-tauri/binaries/<target-triple>/`. Add `-- --force` to download the runtime again. Run the download on a native runner for the target you intend to build.

3. Start the desktop app:

   ```sh
   npm run dev:tauri
   ```

To build the web frontend alone, run `npm run build`. The `dev:tauri` and `tauri:build` scripts download the runtime automatically when it is missing.

## Runtime binaries and distribution

Before starting Tauri, `binaries:stage` copies only the current target's runtime into `src-tauri/binaries/runtime-current/`. The Tauri configuration bundles that directory rather than the full `binaries/` archive, so binaries for other targets are not included. The runtime contains FFmpeg/FFprobe, ImageMagick (`magick`/`convert`), and Poppler (`pdftoppm`/`pdfunite`). Windows bundles libvips too. The libvips project does not publish official standalone executables for macOS or Linux; the current app code does not use the `vips` command, so it is omitted on those systems.

The `dev:tauri` and `tauri:build` scripts download and stage the native runtime automatically. GitHub Actions builds Windows, macOS, and Linux packages separately so each package contains only its platform's binaries. ImageMagick for Linux is distributed as an x86_64 AppImage. The standalone macOS package comes from an external distributor and requires macOS Sonoma or later. Download sources, versions, and checksums are recorded in `runtime-manifest.json`.

Before distributing the app, review the licenses for FFmpeg and its included codecs, ImageMagick, libvips, Poppler, and their included libraries. This repository's MIT license does not replace or change the licenses of bundled programs.

## Contributing

Bug reports and feature ideas are welcome through [GitHub Issues](https://github.com/bispitalieri/biolaris/issues). For larger changes, open an issue to discuss the approach before submitting a pull request. Read the [contribution guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

For vulnerability reports, follow [SECURITY.md](SECURITY.md) instead of posting exploitable details in a public issue.

## License

The code in this project is distributed under the terms of the [MIT License](LICENSE).
