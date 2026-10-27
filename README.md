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
   git clone https://github.com/bispitalieri/biolaris.git
   cd biolaris
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

Before Tauri starts, `binaries:stage` puts the tools for your system in `src-tauri/binaries/runtime-current/`. Tauri packages that folder, which keeps binaries for other platforms out of your build. The folder contains FFmpeg/FFprobe, ImageMagick (`magick`/`convert`), and Poppler (`pdftoppm`/`pdfunite`). Windows builds also include libvips. There are no official standalone libvips builds for macOS or Linux, and the app does not currently use the `vips` command, so those builds leave it out.

The `dev:tauri` and `tauri:build` commands download and prepare the tools automatically. GitHub Actions builds a separate package for Windows, macOS, and Linux, with only the binaries needed by that platform. The Linux build uses an x86_64 ImageMagick AppImage. The standalone macOS package comes from an external distributor and needs macOS Sonoma or later. You can find download sources, versions, and checksums in `runtime-manifest.json`.

Before sharing or distributing the app, check the licenses for FFmpeg and its codecs, ImageMagick, libvips, Poppler, and the libraries they include. The MIT license for this repository does not cover those separate programs.

## Contributing

Found a bug or have an idea? Let us know through [GitHub Issues](https://github.com/bispitalieri/biolaris/issues). For a larger change, open an issue first so we can discuss the approach. See the [contribution guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before getting started.

## Security

If you find a security vulnerability, follow the instructions in [SECURITY.md](SECURITY.md). Please do not post details that could be used to exploit it in a public issue.

## License

Biolaris Media's code is available under the [MIT License](LICENSE).
