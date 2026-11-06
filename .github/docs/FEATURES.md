# Features and supported formats

[English](FEATURES.md) | [Italiano](FEATURES.it.md)

This page describes the tools exposed in the current Biolaris Media interface. Extensions below indicate formats the app recognizes or offers; they do not guarantee that every file can be decoded. Actual support depends on the file contents and the codecs/delegates in the bundled runtime.

## Conversion

Conversion accepts recognized image, audio, and video inputs. PDF files can be used as image-conversion inputs. The app offers these output families:

| Media | Available output formats |
| --- | --- |
| Images | JPG/JPEG, PNG, WebP, AVIF, HEIC/HEIF, JXL, BMP, TIFF/TIF, ICO, GIF, TGA, DDS, HDR, EXR, PCX, PBM, PGM, PPM, PNM |
| Audio | MP3, WAV, FLAC, OGG, M4A, AAC, Opus |
| Video | MP4, WebM, MKV, AVI, MOV; GIF output is also available for supported image and video inputs |

Output choices depend on the detected input category. Some image formats rely on ImageMagick delegates, so support can vary with the bundled runtime. Conversion is not a promise of lossless output.

Recognized image inputs include JPG/JPEG, PNG, WebP, WebP2, HEIC/HEIF, AVIF, JXL, BPG, GIF, BMP, TIFF/TIF, SVG, ICO/ICNS, JFIF/PJPEG/PJPG, PSD, AI, XCF, TGA, DDS, HDR, EXR, WMF, EMF, EPS, PCX/DCX, PBM/PGM/PPM/PNM, and camera RAW extensions CR2, CR3, NEF, ARW, SR2, DNG, RW2, ORF, PEF, RAF, MRW, X3F, ERF, 3FR, and FFF.

Recognized audio input extensions are MP3, WAV, OGG/OGA, MKA, FLAC, M4A/M4R/M4B/M4P, AAC/ADTS, WMA, ALAC, AIFF/AIF, APE, PCM, Opus, SPX, AMR, GSM, MIDI/MID, MPC, WV, DSF, DFF, CAF, TAK, TTA, RA/RAM, AU, SND, VOC, and AC3.

Recognized video input extensions are MP4, MKV, AVI, MOV, WebM, WMV, FLV/F4V, VOB, OGV/OGM, QT, M4V, MPG/MPEG/M2V, 3GP/3G2, TS/MTS/M2TS/M2T, ASF, RM/RMVB, DIVX/XVID, DV, AMV, MJPEG/MJPG, ROQ, YUV, and NUT.

## Compression

Compression preserves the input extension and supports:

- Recognized image inputs other than PDF.
- MP4, MOV, M4V, AVI, MKV, and WebM video.
- MP3, OGG, and OGA audio.

The quality control uses five values from 30 to 70. Compression may re-encode media and does not guarantee a smaller output for every source file.

## Image tools

- **Crop:** accepts recognized image formats and saves the selected crop as a new image.
- **Remove background:** accepts JPG, JPEG, PNG, and WebP; saves a transparent PNG. The BiRefNet Lite 512 model is downloaded on first use and runs locally on the CPU. The image is not uploaded.
- **Vectorize:** accepts PNG, JPG/JPEG, GIF, BMP, TIFF/TIF, and WebP; writes SVG with traced paths. Styles are logo, photo, and black-and-white.
- **Create app icons:** accepts SVG, PNG, JPG/JPEG, and WebP. Raster images must be square and at least 512 × 512 pixels. Generates icon assets for Windows, macOS, iOS, Android, and web projects.

## Audio and video tools

- **Slideshow:** creates MP4 from image inputs; offers 720p, 1080p, 4K, or first-image dimensions and slide durations from 1 to 30 seconds in half-second steps.
- **Combine videos:** combines at least two recognized video inputs and offers MP4, WebM, MKV, AVI, or MOV output.
- **Merge audio:** combines at least two recognized audio inputs and offers MP3, M4A, M4B, AAC, WAV, AIFF, FLAC, OGG, Opus, or AC3. Chapter markers can be added for M4B.
- **Split by chapter:** reads chapter-marked audio or video and exports each chapter separately. Audio outputs are MP3, M4A, WAV, FLAC, OGG, AAC, and Opus; video outputs are MP4, MKV, MOV, WebM, and AVI. The original container can also be retained.
- **Download video:** accepts HTTP/HTTPS links and uses the bundled `yt-dlp` runtime. It processes up to 100 links per job; downloading requires an internet connection. Available sources and formats depend on `yt-dlp` and the source.

## PDF tools

- **Combine PDFs:** combines two or more readable, unencrypted PDF files in the chosen order.
- **Split PDF:** splits readable, unencrypted PDFs into files using page numbers or ranges. Blank ranges produce one output per page.
- **Organize PDF pages:** previews pages, reorders or removes selected pages, and saves an organized copy without replacing the original. This screen is available in the Tauri desktop app.
- **Images to PDF:** accepts JPEG/JPG/JFIF, PNG, WebP, GIF, BMP, and TIFF/TIF. Creates one page per image with fit-to-image, A4, US Letter, or custom page size, adjustable JPEG quality, and optional PDF open password.

Biolaris does not unlock encrypted PDFs. Unlock a protected PDF in another application before adding it.

## Local processing and network

Media conversion and file operations are performed locally by the desktop app. The background-removal model must be fetched once, and video downloads necessarily contact the supplied source. The build setup also fetches platform runtime binaries. No account or hosted Biolaris service is required.
