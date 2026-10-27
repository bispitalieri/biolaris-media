# Contributing

🇬🇧 English | [🇮🇹 Italiano](CONTRIBUTING.it.md)

Thank you for your interest in Biolaris Media. Bug reports, documentation updates, fixes, and feature contributions are welcome.

## Before you start

- Search existing issues before opening a new one.
- For substantial changes, open an issue first to describe the problem and proposed approach.
- Do not commit personal media files, credentials, downloaded binaries, or build output.

## Pull requests

1. Create a dedicated branch for your change.
2. Keep the change focused and update the documentation when behavior changes.
3. Run `npm run build` to check the frontend build. For Rust changes, also run `cargo check --manifest-path src-tauri/Cargo.toml` with the Tauri prerequisites installed.
4. Open a pull request with context, motivation, and the checks you ran. Include screenshots for UI changes when useful.

Maintainers review pull requests. Submitting one does not guarantee acceptance or a particular review timeline.

## Style

Follow the formatting and conventions already used in the code. Prefer simple changes that fit the existing Tauri/React/Rust architecture. If your change needs a new dependency, explain why in the pull request.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
