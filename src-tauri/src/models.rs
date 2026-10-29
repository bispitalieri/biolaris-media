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
pub struct SlideshowRequest {
  pub image_paths: Vec<String>,
  pub output_name: String,
  pub resolution: String,
  pub seconds_per_slide: f64,
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
