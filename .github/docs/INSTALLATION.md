# Installation and first use

[English](INSTALLATION.md) | [Italiano](INSTALLATION.it.md)

## Download a release

Get the current installers from [GitHub Releases](https://github.com/bispitalieri/biolaris-media/releases). Pick a package that matches the operating system and architecture:

| Platform | Package | Notes |
| --- | --- | --- |
| Windows x64 | `.msi` or `.exe` | Run the installer and follow its prompts. |
| macOS Apple silicon | `darwin-aarch64` `.dmg` | Open the disk image and install Biolaris Media. |
| macOS Intel | `darwin-x86_64` `.dmg` | Open the disk image and install Biolaris Media. |
| Linux x64 | `.AppImage`, `.deb`, or `.rpm` | Run the AppImage or install the package using your distribution's package manager. |

Release filenames include the version and target architecture; consult each release's asset list rather than relying on an old filename.

The release workflow can publish macOS builds without Apple signing/notarization. macOS may warn when opening an unsigned app. Windows and Linux builds are produced for x64; Linux ARM64 and Windows ARM64 packages are not published.

## First use and network requirements

- Most media processing runs locally using the tools bundled with the desktop app.
- Background removal fetches the BiRefNet Lite 512 model (about 183 MB) on first use. The model then runs locally on the CPU; selected images are not uploaded.
- Downloading video requires an internet connection to access the source. `yt-dlp` is included in the prepared runtime; no separate installation is normally needed.
- Development setup downloads platform runtime tools before starting or building the desktop app.

## Troubleshooting

**The installer does not match my computer.** Check the release asset's target: `windows-x86_64`, `linux-x86_64`, `darwin-x86_64` (Intel), or `darwin-aarch64` (Apple silicon).

**macOS warns that the app cannot be verified.** Some release builds are unsigned because Apple signing is optional. Only proceed if you downloaded the app from this repository's official Releases page and accept the unsigned-build warning.

**A file or output format is rejected.** Format labels are not a guarantee that every codec or variant is readable. Check the [feature and format reference](FEATURES.md); try a supported alternative if the source file uses an unsupported codec.

**Background removal cannot load its model.** Its first run needs network access to download the model. Retry with a working connection; after download, inference runs locally.

**Video download fails.** The source must be reachable and supported by the included `yt-dlp` version. Try again after updating the app/runtime; not every website or video is available to download.

**A PDF tool rejects a document.** The current PDF operations do not unlock encrypted PDFs. Unlock the file in another application and add it again.
