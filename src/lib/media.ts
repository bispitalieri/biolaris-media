import {invoke} from '@tauri-apps/api/core';
import {listen, type UnlistenFn} from '@tauri-apps/api/event';

export type OutputFormat =
  | 'mp4' | 'webm' | 'mkv' | 'avi' | 'mov' | 'gif'
  | 'mp3' | 'wav' | 'flac' | 'ogg' | 'm4a' | 'aac' | 'opus'
  | 'jpg' | 'jpeg' | 'png' | 'webp' | 'avif' | 'heic' | 'heif' | 'jxl' | 'tga' | 'dds' | 'hdr' | 'exr' | 'pcx' | 'pbm' | 'pgm' | 'ppm' | 'pnm' | 'bmp' | 'tiff' | 'tif' | 'ico' | 'gif'
  | 'pdf';

export type FileType = 'image' | 'audio' | 'video' | 'pdf' | 'raw' | 'unknown';

export type CompressionQuality = 30 | 40 | 50 | 60 | 70;

export const FORMATS_BY_FILE_TYPE: Record<FileType, OutputFormat[]> = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif', 'jxl', 'gif', 'bmp', 'tiff', 'tif', 'ico', 'tga', 'dds', 'hdr', 'exr', 'pcx', 'pbm', 'pgm', 'ppm', 'pnm'],
  raw: ['jpg', 'png', 'webp', 'avif', 'heic', 'heif', 'tiff', 'tif'],
  audio: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'],
  video: ['mp4', 'webm', 'mkv', 'avi', 'mov', 'gif'],
  pdf: ['pdf'],
  unknown: []
};

const IMAGE_EXTS = [
  'jpg', 'jpeg', 'png', 'webp', 'webp2', 'heic', 'heif', 'avif', 'jxl', 'bpg', 'gif', 'bmp', 'tiff', 'tif', 'svg',
  'ico', 'icns', 'jfif', 'pjpeg', 'pjpg', 'psd', 'ai', 'xcf', 'tga', 'dds', 'hdr', 'exr', 'wmf', 'emf', 'eps',
  'pcx', 'dcx', 'pbm', 'pgm', 'ppm', 'pnm'
];
const RAW_EXTS = ['cr2', 'cr3', 'nef', 'arw', 'sr2', 'dng', 'rw2', 'orf', 'pef', 'raf', 'mrw', 'x3f', 'erf', '3fr', 'fff'];
const VIDEO_EXTS = [
  'mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'f4v', 'vob', 'ogv', 'ogm', 'qt',
  'm4v', 'mpg', 'mpeg', 'm2v', '3gp', '3g2', 'ts', 'mts', 'm2ts', 'm2t', 'asf', 'rm', 'rmvb', 'divx', 'xvid', 'dv',
  'amv', 'mjpeg', 'mjpg', 'roq', 'yuv', 'nut'
];
const AUDIO_EXTS = [
  'mp3', 'wav', 'ogg', 'oga', 'mka', 'flac', 'm4a', 'm4r', 'aac', 'adts', 'wma', 'alac', 'aiff', 'aif', 'ape',
  'pcm', 'opus', 'spx', 'amr', 'gsm', 'mid', 'midi', 'm4b', 'm4p', 'mpc', 'wv', 'dsf', 'dff', 'caf', 'tak', 'tta',
  'ra', 'ram', 'au', 'snd', 'voc'
];
const PDF_EXTS = ['pdf'];

export const detectFileType = (filename: string): FileType => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (RAW_EXTS.includes(ext)) return 'raw';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (PDF_EXTS.includes(ext)) return 'pdf';
  return 'unknown';
};

export const getDefaultFormat = (fileType: FileType): OutputFormat => {
  switch (fileType) {
    case 'image': case 'raw': return 'jpg';
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
