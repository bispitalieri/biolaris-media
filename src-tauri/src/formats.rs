use std::path::Path;

pub(crate) fn get_file_ext(path: &Path) -> String {
  path.extension()
    .and_then(|v| v.to_str())
    .unwrap_or("")
    .to_lowercase()
}

pub(crate) fn is_image_ext(ext: &str) -> bool {
  matches!(
    ext,
    "jpg"
      | "jpeg"
      | "png"
      | "webp"
      | "webp2"
      | "heic"
      | "heif"
      | "avif"
      | "jxl"
      | "bpg"
      | "gif"
      | "bmp"
      | "tiff"
      | "tif"
      | "svg"
      | "ico"
      | "icns"
      | "jfif"
      | "pjpeg"
      | "pjpg"
      | "psd"
      | "ai"
      | "xcf"
      | "tga"
      | "dds"
      | "hdr"
      | "exr"
      | "wmf"
      | "emf"
      | "eps"
      | "pcx"
      | "dcx"
      | "pbm"
      | "pgm"
      | "ppm"
      | "pnm"
      | "cr2"
      | "cr3"
      | "nef"
      | "arw"
      | "sr2"
      | "dng"
      | "rw2"
      | "orf"
      | "pef"
      | "raf"
      | "mrw"
      | "x3f"
      | "erf"
      | "3fr"
      | "fff"
    )
}

pub(crate) fn is_video_ext(ext: &str) -> bool {
  matches!(
    ext,
    "mp4"
      | "mkv"
      | "avi"
      | "mov"
      | "webm"
      | "wmv"
      | "flv"
      | "f4v"
      | "vob"
      | "ogv"
      | "ogm"
      | "qt"
      | "m4v"
      | "mpg"
      | "mpeg"
      | "m2v"
      | "3gp"
      | "3g2"
      | "ts"
      | "mts"
      | "m2ts"
      | "m2t"
      | "asf"
      | "rm"
      | "rmvb"
      | "divx"
      | "xvid"
      | "dv"
      | "amv"
      | "mjpeg"
      | "mjpg"
      | "roq"
      | "yuv"
      | "nut"
    )
}

pub(crate) fn is_audio_ext(ext: &str) -> bool {
  matches!(
    ext,
    "mp3"
      | "wav"
      | "ogg"
      | "oga"
      | "mka"
      | "flac"
      | "m4a"
      | "m4r"
      | "aac"
      | "adts"
      | "wma"
      | "alac"
      | "aiff"
      | "aif"
      | "ape"
      | "pcm"
      | "opus"
      | "spx"
      | "amr"
      | "gsm"
      | "mid"
      | "midi"
      | "m4b"
      | "m4p"
      | "mpc"
      | "wv"
      | "dsf"
      | "dff"
      | "caf"
      | "tak"
      | "tta"
      | "ra"
      | "ram"
      | "au"
      | "snd"
      | "voc"
    )
}

/// Formats commonly supported by FFmpeg's image2 pipeline and its bundled codecs.
/// Less common image formats are delegated to ImageMagick, whose delegates vary
/// by installation (for example HEIC and JPEG XL support).
pub(crate) fn is_ffmpeg_image_ext(ext: &str) -> bool {
  matches!(
    ext,
    "jpg" | "jpeg" | "png" | "webp" | "bmp" | "gif" | "tif" | "tiff"
  )
}

pub(crate) fn ffmpeg_codec_args_for_format(fmt: &str) -> Vec<String> {
  match fmt {
    "mp4" => vec!["-c:v".into(), "libx264".into(), "-c:a".into(), "aac".into()],
    "webm" => vec![
      "-c:v".into(),
      "libvpx-vp9".into(),
      "-c:a".into(),
      "libopus".into(),
    ],
    "mkv" => vec!["-c:v".into(), "libx264".into(), "-c:a".into(), "aac".into()],
    "avi" => vec!["-c:v".into(), "libx264".into(), "-c:a".into(), "mp3".into()],
    "mov" => vec!["-c:v".into(), "libx264".into(), "-c:a".into(), "aac".into()],
    "gif" => vec!["-vf".into(), "fps=10,scale=320:-1:flags=lanczos".into()],
    "mp3" => vec!["-vn".into(), "-c:a".into(), "libmp3lame".into()],
    "wav" => vec!["-vn".into(), "-c:a".into(), "pcm_s16le".into()],
    "flac" => vec!["-vn".into(), "-c:a".into(), "flac".into()],
    "ogg" => vec!["-vn".into(), "-c:a".into(), "libvorbis".into()],
    "m4a" => vec!["-vn".into(), "-c:a".into(), "aac".into()],
    "aac" => vec!["-vn".into(), "-c:a".into(), "aac".into()],
    "opus" => vec!["-vn".into(), "-c:a".into(), "libopus".into()],
    _ => vec![],
  }
}

pub(crate) fn ffmpeg_audio_quality_args(fmt: &str, quality: u8) -> Vec<String> {
  let quality = quality.clamp(1, 100) as u32;
  match fmt {
    // LAME VBR uses 0 for its highest quality and 9 for its lowest.
    "mp3" => vec!["-q:a".into(), (((100 - quality) * 9) / 100).to_string()],
    // Vorbis quality is expressed from 0 to 10.
    "ogg" => vec!["-q:a".into(), format!("{:.1}", quality as f32 / 10.0)],
    // AAC and Opus use bitrate-based quality settings.
    "m4a" | "aac" => vec!["-b:a".into(), format!("{}k", 64 + (quality * 256 / 100))],
    "opus" => vec!["-b:a".into(), format!("{}k", 32 + (quality * 224 / 100))],
    // FLAC remains lossless; higher settings spend more time compressing.
    "flac" => vec![
      "-compression_level".into(),
      (quality * 12 / 100).to_string(),
    ],
    // WAV is lossless. At the top of the range, export at 24-bit depth.
    "wav" if quality >= 90 => vec!["-c:a".into(), "pcm_s24le".into()],
    _ => Vec::new(),
  }
}

pub(crate) fn is_video_out(fmt: &str) -> bool {
  matches!(fmt, "mp4" | "webm" | "mkv" | "avi" | "mov")
}

pub(crate) fn video_crf(quality: u8) -> u8 {
  // The UI uses 0..100 where a larger value means better quality.
  (51.0 - (quality.min(100) as f32 * 0.33))
    .round()
    .clamp(18.0, 51.0) as u8
}

pub(crate) fn valid_conversion_pair(input: &str, output: &str) -> bool {
  let image_output = matches!(
    output,
    "jpg"
      | "jpeg"
      | "png"
      | "webp"
      | "avif"
      | "heic"
      | "heif"
      | "jxl"
      | "bmp"
      | "tif"
      | "tiff"
      | "ico"
      | "gif"
      | "tga"
      | "dds"
      | "hdr"
      | "exr"
      | "pcx"
      | "pbm"
      | "pgm"
      | "ppm"
      | "pnm"
    );
  let audio_output = matches!(
    output,
    "mp3" | "wav" | "flac" | "ogg" | "m4a" | "aac" | "opus"
  );
  let video_output = matches!(output, "mp4" | "webm" | "mkv" | "avi" | "mov");
  (image_output && (is_image_ext(input) || input == "pdf"))
    || (audio_output && is_audio_ext(input))
    || (video_output && (is_video_ext(input) || is_audio_ext(input)))
    || (output == "gif" && is_video_ext(input))
}

pub(crate) fn is_compressible(ext: &str) -> bool {
  (is_image_ext(ext) && ext != "pdf")
    || matches!(ext, "mp4" | "mov" | "m4v" | "avi" | "mkv" | "webm")
    || matches!(ext, "mp3" | "ogg" | "oga")
}
