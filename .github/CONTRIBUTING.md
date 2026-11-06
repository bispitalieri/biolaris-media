# Contributing

🇬🇧 English | [🇮🇹 Italiano](CONTRIBUTING.it.md)

Thanks for taking an interest in Biolaris Media. Bug reports, documentation, fixes, and new features are all welcome.

## Before you start

- Check the open issues first to see if someone has already raised the same problem or idea.
- If you are planning a larger change, open an issue first so we can talk through the approach.
- Please keep personal media files, credentials, downloaded binaries, and build output out of commits.

## Pull requests

1. Create a branch for your change.
2. Keep the change focused. If it changes how the app works, update the documentation too.
3. Run `npm run build`. If you changed Rust code, also run `cargo check --manifest-path src-tauri/Cargo.toml` (you will need the Tauri prerequisites for your platform).
4. In your pull request, explain what changed and why, and tell us which checks you ran. Screenshots are helpful for changes to the interface.

A maintainer will review your pull request. We cannot promise that every suggestion will be accepted or give a review date in advance.

## Style

Follow the formatting and patterns already used in the code. Keep changes straightforward and in line with the Tauri, React, and Rust structure. If you add a dependency, explain why it is needed in the pull request.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
