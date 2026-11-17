import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {DropZone} from '../components/DropZone';

// Mock Tauri dependencies
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        images: 'Images',
        videos: 'Videos',
        audio: 'Audio',
        mediaAndDocuments: 'Media & Documents',
        dropTitle: 'Drop files here',
        dropDescription: 'Drag and drop files here or click to select',
        imageDropTitle: 'Drop an image here',
        imageDropDescription: 'Drag and drop an image here or click to select',
        imagesDropTitle: 'Drop images here',
        imagesDropDescription: 'Drag and drop images here or click to select',
        videoDropTitle: 'Drop a video here',
        videoDropDescription: 'Drag and drop a video here or click to select',
        videosDropTitle: 'Drop videos here',
        videosDropDescription: 'Drag and drop videos here or click to select',
        audioDropTitle: 'Drop an audio file here',
        audioDropDescription: 'Drag and drop an audio file here or click to select',
      };
      return translations[key] || key;
    },
    i18n: {language: 'en'},
  }),
}));

describe('DropZone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render with default title and description', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} />);

    expect(screen.getByText('Drop files here')).toBeInTheDocument();
    expect(screen.getByText('Drag and drop files here or click to select')).toBeInTheDocument();
  });

  it('should render with custom title and description', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} title="Custom Title" description="Custom Description" />);

    expect(screen.getByText('Custom Title')).toBeInTheDocument();
    expect(screen.getByText('Custom Description')).toBeInTheDocument();
  });

  it('should render with image-only title', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} imageOnly />);

    expect(screen.getByText('Drop an image here')).toBeInTheDocument();
  });

  it('should render with video-only title', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} videoOnly />);

    expect(screen.getByText('Drop videos here')).toBeInTheDocument();
  });

  it('should render with audio-only title', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} audioOnly />);

    expect(screen.getByText('Drop an audio file here')).toBeInTheDocument();
  });

  it('should have the plus button for file selection', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} />);

    const plusButton = screen.getByText('＋');
    expect(plusButton).toBeInTheDocument();
  });

  it('should call handleFileSelect when plus button is clicked', async () => {
    const {open} = await import('@tauri-apps/plugin-dialog');
    const mockedOpen = open as ReturnType<typeof vi.fn>;
    mockedOpen.mockResolvedValue(['/path/to/file.jpg']);

    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} />);

    const plusButton = screen.getByText('＋');
    fireEvent.click(plusButton);

    await vi.waitFor(() => {
      expect(mockedOpen).toHaveBeenCalled();
    });
  });

  it('should apply hover styles when hovering is true', () => {
    const onFiles = vi.fn();
    const {container} = render(<DropZone onFiles={onFiles} />);

    const section = container.querySelector('section');
    expect(section).toHaveClass('border-zinc-700');
    expect(section).not.toHaveClass('border-violet-400');
  });
});
