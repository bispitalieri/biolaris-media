import {invoke} from '@tauri-apps/api/core';
import {listen, type UnlistenFn} from '@tauri-apps/api/event';

export type OutputFormat =
  | 'mp4' | 'webm'
  | 'mp3' | 'wav' | 'flac'
  | 'jpg' | 'png' | 'webp' | 'gif' | 'bmp' | 'tiff'
  | 'pdf';

export type FileType = 'image' | 'audio' | 'video' | 'pdf' | 'unknown';

export type CompressionQuality = 30 | 40 | 50 | 60 | 70;

export const FORMATS_BY_FILE_TYPE: Record<FileType, OutputFormat[]> = {
  image: ['jpg', 'png', 'webp', 'gif', 'bmp', 'tiff'],
  audio: ['mp3', 'wav', 'flac'],
  video: ['mp4', 'webm'],
  pdf: ['pdf'],
  unknown: []
};

export const detectFileType = (filename: string): FileType => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'svg', 'heic', 'heif', 'avif'];
  const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'];
  const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'm4v', '3gp', 'ogv'];
  const pdfExts = ['pdf'];

  if (imageExts.includes(ext)) return 'image';
  if (audioExts.includes(ext)) return 'audio';
  if (videoExts.includes(ext)) return 'video';
  if (pdfExts.includes(ext)) return 'pdf';
  return 'unknown';
};

export const getDefaultFormat = (fileType: FileType): OutputFormat => {
  switch (fileType) {
    case 'image': return 'jpg';
    case 'audio': return 'mp3';
    case 'video': return 'mp4';
    case 'pdf': return 'pdf';
    default: return 'mp4';
  }
};

export type ConversionRequest = {
  inputPath: string;
  outputPath: string;
  format: OutputFormat;
  quality: number;
  preserveMetadata: boolean
};

export type CompressionRequest = {
  inputPath: string;
  outputPath: string;
  quality: CompressionQuality;
  preserveMetadata: boolean
};

export type JobUpdate = {
  id: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  outputPath: string | null;
  error: string | null
};

export const enqueueConversion = (request: ConversionRequest) => invoke<string>('enqueue_conversion', {request});

export const enqueueCompression = (request: CompressionRequest) => invoke<string>('enqueue_compression', {request});

export const getParallelism = () => invoke<number>('available_parallelism');

export const subscribeToProgress = (callback: (update: JobUpdate) => void): Promise<UnlistenFn> =>
  listen<JobUpdate>('conversion-progress', ({payload}) => callback(payload));

