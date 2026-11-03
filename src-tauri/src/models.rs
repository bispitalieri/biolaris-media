use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Semaphore;

/// Number of simultaneous encoders is capped to avoid saturating the machine.
pub struct QueueState {
  pub(crate) slots: Arc<Semaphore>,
}
impl Default for QueueState {
  fn default() -> Self {
    Self {
      slots: Arc::new(Semaphore::new(num_cpus::get().max(1))),
    }
  }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionRequest {
  pub input_path: String,
  pub output_path: String,
  pub format: String,
  pub quality: u8,
  pub preserve_metadata: bool,
  #[serde(default = "default_true")]
  pub auto_rename_outputs: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionRequest {
  pub input_path: String,
  pub output_path: String,
  pub quality: u8,
  pub preserve_metadata: bool,
  #[serde(default = "default_true")]
  pub auto_rename_outputs: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropRequest {
  pub input_path: String,
  pub output_path: String,
  pub x: u32,
  pub y: u32,
  pub width: u32,
  pub height: u32,
  #[serde(default = "default_true")]
  pub auto_rename_outputs: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBackgroundPngRequest {
  pub output_path: String,
  pub png_base64: String,
  #[serde(default = "default_true")]
  pub auto_rename_outputs: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideshowRequest {
  pub image_paths: Vec<String>,
  pub output_name: String,
  pub resolution: String,
  pub seconds_per_slide: f64,
  #[serde(default = "default_true")]
  pub auto_rename_outputs: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombineVideosRequest {
  pub video_paths: Vec<String>,
  pub output_name: String,
  pub format: String,
  #[serde(default = "default_true")]
  pub auto_rename_outputs: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeAudioRequest {
  pub audio_paths: Vec<String>,
  pub output_name: String,
  pub format: String,
  pub add_chapter_markers: bool,
  #[serde(default = "default_true")]
  pub auto_rename_outputs: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombinePdfsRequest {
  pub pdf_paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitPdfsRequest {
  pub pdf_paths: Vec<String>,
  pub page_ranges: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizePdfPagesRequest {
  pub pdf_path: String,
  pub page_numbers: Vec<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitByChapterRequest {
  pub input_path: String,
  /// "original" keeps the source container and streams unchanged.
  pub format: String,
  #[serde(default = "default_true")]
  pub auto_rename_outputs: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorizeRequest {
  pub input_path: String,
  pub output_path: String,
  pub style: String,
  #[serde(default = "default_true")]
  pub auto_rename_outputs: bool,
}

fn default_true() -> bool {
  true
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobUpdate {
  pub id: String,
  pub status: String,
  pub progress: u8,
  pub output_path: Option<String>,
  pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFileInfo {
  pub codec_name: String,
  pub sample_rate: u32,
  pub channels: u32,
  pub channel_layout: Option<String>,
  pub profile: Option<String>,
  pub duration: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfFileInfo {
  pub page_count: Option<usize>,
  pub size_bytes: u64,
  pub locked: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPagePreview {
  pub page_number: u32,
  pub data_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterInfo {
  pub title: String,
  pub start: f64,
  pub end: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterFileInfo {
  pub chapters: Vec<ChapterInfo>,
  pub has_audio: bool,
  pub has_video: bool,
  pub original_format: String,
}
