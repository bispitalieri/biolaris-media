# Third-party notices

Biolaris Media bundles the command-line tools below as separate executables. The app
invokes them as subprocesses. The versions listed here were read from the ARM64
macOS runtime snapshot in `src-tauri/binaries/aarch64-apple-darwin/runtime-manifest.json`
and from the binaries themselves on 2026-11-23. Other release targets carry their
own `runtime-manifest.json` under the packaged `runtime/<target>/` directory; use
that manifest and the corresponding upstream release to identify the exact asset
and checksum in a particular installer. The runtime downloader follows the
`runtime-latest` tag and upstream latest releases, so versions can change between
app releases.

## Runtime tools

### FFmpeg and FFprobe

Version observed: 8.1.2 (unpins standalone build). The shipped build reports
`--enable-gpl` and `--enable-version3`, so these binaries are licensed under the
GNU General Public License version 3 or later (GPL-3.0-or-later), not merely the
default FFmpeg LGPL terms. Its configuration enables GPL components including
x264, x265, Xvid, vid.stab, and Rubber Band. The build also enables separately
licensed libraries; retain their notices as specified by their respective
projects. The FFmpeg project explains the effect of GPL build options and its
license terms in its [legal notice](https://www.ffmpeg.org/legal.html) and
[license files](https://github.com/FFmpeg/FFmpeg/tree/master).

### Poppler utilities (`pdftoppm`, `pdfunite`)

Version observed: 26.06.0. Poppler is based on Xpdf and is distributed under GPL
terms; Poppler contributions are GPL-2.0-or-later, while the Xpdf-derived core
contains files available under GPL-2.0-only or GPL-3.0-only. The bundled
`poppler-utils` build embeds Poppler CMaps and encoding data; those data include
separately licensed materials. See the [Poppler project](https://poppler.freedesktop.org/),
the [upstream utility build and data notes](https://github.com/unpins/poppler-utils),
and its [release source](https://gitlab.freedesktop.org/poppler/poppler).

### ImageMagick (`magick`, `convert` alias)

Version observed on macOS ARM64: 7.1.2-11. ImageMagick is licensed under the
[ImageMagick License](https://imagemagick.org/license/); copyright © 1999
ImageMagick Studio LLC. Include that license and attribution when redistributing
the software. The observed static macOS executable reports built-in delegates
for bzip2, DjVu, FreeType, HEIC, JPEG 2000, JPEG, Little CMS, PNG, RAW, TIFF,
WebP, and zlib. These embedded components retain their own licenses and notices;
the runtime manifest does not enumerate their exact revisions or license texts.
Their upstream license sources include [DjVuLibre](https://sourceforge.net/p/djvu/djvulibre/),
[FreeType](https://freetype.org/license.html), [libheif](https://github.com/strukturag/libheif),
[OpenJPEG](https://www.openjpeg.org/), [libjpeg-turbo](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/LICENSE.md),
[Little CMS](https://github.com/mm2/Little-CMS), [LibRaw](https://www.libraw.org/about),
[LibTIFF](https://libtiff.gitlab.io/libtiff/project/license.html),
[libwebp](https://chromium.googlesource.com/webm/libwebp/),
[libpng](http://www.libpng.org/pub/png/src/libpng-LICENSE.txt),
[bzip2](https://sourceware.org/bzip2/), and [zlib](https://zlib.net/).
For the delegate families visible in this snapshot, upstream identifies these
license terms: DjVuLibre GPL-2.0-or-later; FreeType FTL or GPL-2.0-only;
libheif LGPL-3.0-or-later; OpenJPEG BSD-2-Clause; libjpeg-turbo IJG plus
BSD-3-Clause; Little CMS MIT; LibRaw LGPL-2.1-only or CDDL-1.0 (with BSD/MIT
components); libwebp BSD-3-Clause; libpng PNG Reference Library License; and
zlib and bzip2 under their respective permissive licenses. The TIFF component
uses the separate libtiff license. The exact delegate versions are absent from
the runtime manifest, so use the upstream license sources above for their full
terms and preserve notices from the actual build.

The macOS runtime currently obtains this static executable from the third-party
[standalone build](https://mendelson.org/imagemagick.html), rather than building
it from source in this repository. Its embedded delegate inventory and their
license texts are not included in the runtime manifest, so that artifact does
not provide a complete machine-readable third-party bill of materials.

#### ImageMagick License summary

Copyright © 1999 ImageMagick Studio LLC.

1. **Definitions.** “License” means these terms. “Licensor” means the copyright
owner or authorized grantor. “You” means the individual or legal entity
exercising the permissions granted here. “Work” means the software and its
documentation in source or object form. “Derivative Works” are works based on
the Work. “Contribution” means work intentionally submitted for inclusion by
the Licensor.

2. **Copyright grant.** Each Contributor grants You a perpetual, worldwide,
non-exclusive, no-charge, royalty-free, irrevocable license to reproduce,
prepare Derivative Works of, publicly display, publicly perform, sublicense,
and distribute the Work and Derivative Works in source or object form.

3. **Patent grant.** Each Contributor grants You a perpetual, worldwide,
non-exclusive, no-charge, royalty-free, irrevocable patent license to make,
use, sell, and import the Work. The patent license terminates for a party that
files patent litigation alleging that the Work infringes a patent.

4. **Redistribution.** You may distribute copies or Derivative Works if You:
(a) give recipients a copy of this License; (b) mark modified files with
prominent notices describing the changes; (c) retain copyright, patent,
trademark, and attribution notices in source form; and (d) include readable
attribution notices in a NOTICE file or documentation when one is included.
You may add Your own copyright statement and different terms for Your changes.

5. **Contributions.** Unless stated otherwise, Contributions submitted for
inclusion are under this License, without additional terms.

6. **Trademarks.** This License does not grant rights to use the Licensor's
trade names, trademarks, service marks, or product names except to describe the
origin of the Work in a reasonable and customary way.

7. **Warranty disclaimer.** Unless required by law or agreed in writing, the
Licensor provides the Work “AS IS”, without warranties or conditions of any
kind.

8. **Limitation of liability.** No Contributor is liable for direct, indirect,
special, incidental, or consequential damages arising from use or inability to
use the Work.

The terms above are a summary, not the license text. The [official ImageMagick
License](https://imagemagick.org/license/) is authoritative and must accompany
redistributions containing ImageMagick.

### yt-dlp

Version observed: 2026.10.26. yt-dlp's source is released under the [Unlicense](https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/LICENSE).
The bundled platform executable is a PyInstaller build and is instead licensed
as a combined work under GPL-3.0-or-later. It also contains components under
other licenses; the complete, version-matched list is in yt-dlp's
[third-party licenses file](https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/THIRD_PARTY_LICENSES.txt).

### Runtime provenance limitation

The ARM64 macOS runtime manifest records an asset URL and SHA-256 for ImageMagick
and yt-dlp, but not the component versions or checksums for the unpins FFmpeg and
Poppler packages. The other platform runtime manifests are generated/downloaded
separately and are not committed to this repository. The build pipeline should
retain the runtime manifest with every published installer; ImageMagick's macOS
delegate licenses still need to be audited from the exact distributable/source
bundle before claiming a complete per-binary inventory.

## BiRefNet Lite 512

Model: [`studioludens/birefnet-lite-512`](https://huggingface.co/studioludens/birefnet-lite-512), revision `962e67969ec6acec9c19fab76acee4f5e22e990c`.

Copyright (c) 2024 ZhengPeng  
Copyright (c) 2026 Studio Ludens V.O.F.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
