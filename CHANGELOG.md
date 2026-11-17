## [unreleased]

### 📚 Documentation

- Move documentation into .github and restructure READMEs
- *(readme)* Enhance project documentation with tech stack, alternatives, and badges

### ⚙️ Miscellaneous Tasks

- Drop tauri/custom-protocol feature from Rust warm build
- *(workflows)* Use explicit npm cache and git-cliff release notes
- Mark package as private
## [0.1.2] - 2026-11-05

### 🚀 Features

- *(ci)* Warm Rust cache on main pushes and bump to 0.1.2

### ⚙️ Miscellaneous Tasks

- *(workflows)* Remove tauri/custom-protocol from warm build
- Prepare runtime placeholder and gate release cache saves
- Precompile tauri/custom-protocol feature during dependency warm-up
## [0.1.1] - 2026-11-05

### ⚙️ Miscellaneous Tasks

- *(release)* Rework release asset naming and Tauri updater handling
## [0.1.0] - 2026-11-05

### 🚀 Features

- Add Tauri application icons
- Add slideshow screen to convert images to MP4 videos
- Add auto-rename outputs setting and open output commands
- Add AppIcon generation screen and backend command
- Add remove background screen with AI subject segmentation
- Add combine videos screen and backend command
- Add video download via yt-dlp
- Add image vectorization to SVG
- Add merge audio feature with chapter markers support
- Add PDF combining and split-by-chapter features
- Switch license to AGPL-3.0 and add release publishing workflow
- Fetch latest yt-dlp release directly from GitHub
- *(runtime)* Create tool aliases in user cache at startup
- *(pdf)* Add split PDFs feature
- Add PDF organize pages feature
- Add images-to-pdf conversion
- *(ui)* Update sidebar icons
- *(updater)* Add in-app update flow and release signing configuration
- *(ci)* Make Apple signing optional for macOS releases
- *(download-binaries)* Scarica unpin prebuilt su Windows dai GitHub Releases
- Prefer published runtime bundles when downloading binaries

### 🐛 Bug Fixes

- *(media)* Correct binary downloads and crop image sizing
- *(ci)* Narrow artifact upload paths per platform

### 🚜 Refactor

- *(scripts)* Build unpin CLI from source instead of downloading binary
- Split backend into modular crates and commands
- *(sidebar)* Reorder navigation items and update app icon label
- Use maxDownloadBytes for yt-dlp download and remove run-workflow skill
- Update PDF section icons in sidebar
- *(remove-bg)* Force WASM CPU inference and optimize release build

### 🎨 Styling

- Reformat rust source files
- *(ui)* Improve scroll behavior and add version display

### ⚙️ Miscellaneous Tasks

- Expose GitHub token to tauri build and propagate it to binary downloads
- Update app icons list in tauri config
- Add tauri build targets
- Widen artifact path glob
- Add version:update script and make set-version path-aware
- Rework release pipeline and read version from env
- Add checkout step to retrieve build artifacts
- Track src-tauri/Cargo.lock for reproducible builds
- Split release job into separate workflow triggered by Build and deploy
- Verify release tag matches committed version before build
- Bump version to 0.1.1
- Restructure validation and release workflows
- Revert version to 0.1.0
- Improve release workflow performance and reliability
- *(release)* Use ubuntu-latest runner label
- *(release)* Generate release notes before creating draft release
- *(release)* Improve asset staging and Rust caching

### 💼 Other

- Switch Windows CI target to MSVC and remove staticlib crate type
