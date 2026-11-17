import {describe, it, expect} from 'vitest';
import {detectFileType, getDefaultFormat, FORMATS_BY_FILE_TYPE} from '../lib/media';

describe('detectFileType', () => {
  it('should detect image files', () => {
    expect(detectFileType('photo.jpg')).toBe('image');
    expect(detectFileType('photo.jpeg')).toBe('image');
    expect(detectFileType('photo.png')).toBe('image');
    expect(detectFileType('photo.webp')).toBe('image');
    expect(detectFileType('photo.avif')).toBe('image');
    expect(detectFileType('photo.heic')).toBe('image');
    expect(detectFileType('photo.gif')).toBe('image');
    expect(detectFileType('photo.bmp')).toBe('image');
    expect(detectFileType('photo.tiff')).toBe('image');
    expect(detectFileType('photo.svg')).toBe('image');
    expect(detectFileType('photo.psd')).toBe('image');
    expect(detectFileType('photo.tga')).toBe('image');
    expect(detectFileType('photo.dds')).toBe('image');
    expect(detectFileType('photo.hdr')).toBe('image');
    expect(detectFileType('photo.exr')).toBe('image');
  });

  it('should detect raw image files', () => {
    expect(detectFileType('photo.cr2')).toBe('raw');
    expect(detectFileType('photo.nef')).toBe('raw');
    expect(detectFileType('photo.arw')).toBe('raw');
    expect(detectFileType('photo.dng')).toBe('raw');
    expect(detectFileType('photo.rw2')).toBe('raw');
  });

  it('should detect audio files', () => {
    expect(detectFileType('song.mp3')).toBe('audio');
    expect(detectFileType('song.wav')).toBe('audio');
    expect(detectFileType('song.flac')).toBe('audio');
    expect(detectFileType('song.ogg')).toBe('audio');
    expect(detectFileType('song.m4a')).toBe('audio');
    expect(detectFileType('song.aac')).toBe('audio');
    expect(detectFileType('song.opus')).toBe('audio');
  });

  it('should detect video files', () => {
    expect(detectFileType('video.mp4')).toBe('video');
    expect(detectFileType('video.mkv')).toBe('video');
    expect(detectFileType('video.avi')).toBe('video');
    expect(detectFileType('video.mov')).toBe('video');
    expect(detectFileType('video.webm')).toBe('video');
    expect(detectFileType('video.wmv')).toBe('video');
    expect(detectFileType('video.flv')).toBe('video');
  });

  it('should detect PDF files', () => {
    expect(detectFileType('document.pdf')).toBe('pdf');
  });

  it('should return unknown for unrecognized extensions', () => {
    expect(detectFileType('file.xyz')).toBe('unknown');
    expect(detectFileType('file')).toBe('unknown');
    expect(detectFileType('')).toBe('unknown');
  });

  it('should handle case-insensitive extensions', () => {
    expect(detectFileType('photo.JPG')).toBe('image');
    expect(detectFileType('photo.Jpeg')).toBe('image');
    expect(detectFileType('video.MP4')).toBe('video');
    expect(detectFileType('song.FLAC')).toBe('audio');
    expect(detectFileType('document.PDF')).toBe('pdf');
  });

  it('should handle files with multiple dots', () => {
    expect(detectFileType('my.photo.backup.jpg')).toBe('image');
    expect(detectFileType('video.recording.2024.mp4')).toBe('video');
  });

  it('should handle files with path', () => {
    expect(detectFileType('/path/to/photo.jpg')).toBe('image');
    expect(detectFileType('C:\\Users\\photo\\video.mp4')).toBe('video');
  });
});

describe('getDefaultFormat', () => {
  it('should return jpg for image and raw', () => {
    expect(getDefaultFormat('image')).toBe('jpg');
    expect(getDefaultFormat('raw')).toBe('jpg');
  });

  it('should return mp3 for audio', () => {
    expect(getDefaultFormat('audio')).toBe('mp3');
  });

  it('should return mp4 for video', () => {
    expect(getDefaultFormat('video')).toBe('mp4');
  });

  it('should return png for pdf', () => {
    expect(getDefaultFormat('pdf')).toBe('png');
  });

  it('should return jpg for unknown', () => {
    expect(getDefaultFormat('unknown')).toBe('jpg');
  });
});

describe('FORMATS_BY_FILE_TYPE', () => {
  it('should have formats for all file types', () => {
    expect(FORMATS_BY_FILE_TYPE.image.length).toBeGreaterThan(0);
    expect(FORMATS_BY_FILE_TYPE.raw.length).toBeGreaterThan(0);
    expect(FORMATS_BY_FILE_TYPE.audio.length).toBeGreaterThan(0);
    expect(FORMATS_BY_FILE_TYPE.video.length).toBeGreaterThan(0);
    expect(FORMATS_BY_FILE_TYPE.pdf.length).toBeGreaterThan(0);
    expect(FORMATS_BY_FILE_TYPE.unknown).toEqual([]);
  });

  it('should include default format in available formats', () => {
    expect(FORMATS_BY_FILE_TYPE.image).toContain('jpg');
    expect(FORMATS_BY_FILE_TYPE.audio).toContain('mp3');
    expect(FORMATS_BY_FILE_TYPE.video).toContain('mp4');
    expect(FORMATS_BY_FILE_TYPE.pdf).toContain('png');
  });
});
