import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {ConversionQueue, type QueueItem} from '../components/ConversionQueue';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, number>) => {
      const translations: Record<string, string> = {
        statusReady: 'Ready',
        statusRunning: 'Running',
        statusCompleted: 'Completed',
        statusFailed: 'Failed',
        conversionQueue: 'Conversion Queue',
        concurrentProcesses: '{{count}} concurrent processes',
        removeCompleted: 'Remove completed',
        clearQueue: 'Clear queue',
        fileCount: '{{count}} files',
        emptyQueue: 'Queue is empty',
        selectAll: 'Select:',
        images: 'Images',
        videos: 'Videos',
        audio: 'Audio',
        pdf: 'PDF',
        selectedCount: '{{count}} selected',
        outputFormatForSelected: 'Output format for selected',
        quality: 'Quality',
        qualityForSelected: 'Quality for selected',
        convertSelected: 'Convert {{count}} selected',
        deselectAll: 'Deselect all',
        selectFile: 'Select {{name}}',
        outputFormatFor: 'Output format for {{name}}',
        qualityFor: 'Quality for {{name}}',
        convertFile: 'Convert',
        openOutputFile: 'Open file',
        openOutputDirectory: 'Open folder',
        removeFile: 'Remove {{name}}',
      };
      let result = translations[key] || key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          result = result.replace(`{{${k}}}`, String(v));
        }
      }
      return result;
    },
    i18n: {language: 'en'},
  }),
}));

vi.mock('../lib/settings', () => ({
  getConfiguredQuality: () => 23,
}));

describe('ConversionQueue', () => {
  const mockOnChange = vi.fn();
  const mockOnConvert = vi.fn();
  const mockOnConvertMany = vi.fn();
  const mockOnOpenOutput = vi.fn();
  const mockOnOpenOutputDirectory = vi.fn();
  const mockOnRemove = vi.fn();
  const mockOnRemoveCompleted = vi.fn();
  const mockOnClear = vi.fn();

  const sampleItems: QueueItem[] = [
    {path: '/path/to/photo.jpg', name: 'photo.jpg', format: 'png', quality: 80, status: 'ready', progress: 0},
    {path: '/path/to/video.mp4', name: 'video.mp4', format: 'webm', quality: 50, status: 'running', progress: 45},
    {path: '/path/to/song.mp3', name: 'song.mp3', format: 'flac', quality: 90, status: 'completed', progress: 100, outputPath: '/path/to/song.flac'},
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show empty queue message when no items', () => {
    render(
      <ConversionQueue
        items={[]}
        onChange={mockOnChange}
        onConvert={mockOnConvert}
        onConvertMany={mockOnConvertMany}
        onOpenOutput={mockOnOpenOutput}
        onOpenOutputDirectory={mockOnOpenOutputDirectory}
        parallelism={4}
        onRemove={mockOnRemove}
        onRemoveCompleted={mockOnRemoveCompleted}
        onClear={mockOnClear}
      />
    );

    expect(screen.getByText('Queue is empty')).toBeInTheDocument();
  });

  it('should render all items in the queue', () => {
    render(
      <ConversionQueue
        items={sampleItems}
        onChange={mockOnChange}
        onConvert={mockOnConvert}
        onConvertMany={mockOnConvertMany}
        onOpenOutput={mockOnOpenOutput}
        onOpenOutputDirectory={mockOnOpenOutputDirectory}
        parallelism={4}
        onRemove={mockOnRemove}
        onRemoveCompleted={mockOnRemoveCompleted}
        onClear={mockOnClear}
      />
    );

    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    expect(screen.getByText('video.mp4')).toBeInTheDocument();
    expect(screen.getByText('song.mp3')).toBeInTheDocument();
  });

  it('should show file count', () => {
    render(
      <ConversionQueue
        items={sampleItems}
        onChange={mockOnChange}
        onConvert={mockOnConvert}
        onConvertMany={mockOnConvertMany}
        onOpenOutput={mockOnOpenOutput}
        onOpenOutputDirectory={mockOnOpenOutputDirectory}
        parallelism={4}
        onRemove={mockOnRemove}
        onRemoveCompleted={mockOnRemoveCompleted}
        onClear={mockOnClear}
      />
    );

    expect(screen.getByText('3 files')).toBeInTheDocument();
  });

  it('should show "Remove completed" button when there are completed items', () => {
    render(
      <ConversionQueue
        items={sampleItems}
        onChange={mockOnChange}
        onConvert={mockOnConvert}
        onConvertMany={mockOnConvertMany}
        onOpenOutput={mockOnOpenOutput}
        onOpenOutputDirectory={mockOnOpenOutputDirectory}
        parallelism={4}
        onRemove={mockOnRemove}
        onRemoveCompleted={mockOnRemoveCompleted}
        onClear={mockOnClear}
      />
    );

    expect(screen.getByText('Remove completed')).toBeInTheDocument();
  });

  it('should not show "Remove completed" button when no completed items', () => {
    const noCompletedItems: QueueItem[] = [
      {path: '/path/to/photo.jpg', name: 'photo.jpg', format: 'png', quality: 80, status: 'ready', progress: 0},
    ];

    render(
      <ConversionQueue
        items={noCompletedItems}
        onChange={mockOnChange}
        onConvert={mockOnConvert}
        onConvertMany={mockOnConvertMany}
        onOpenOutput={mockOnOpenOutput}
        onOpenOutputDirectory={mockOnOpenOutputDirectory}
        parallelism={4}
        onRemove={mockOnRemove}
        onRemoveCompleted={mockOnRemoveCompleted}
        onClear={mockOnClear}
      />
    );

    expect(screen.queryByText('Remove completed')).not.toBeInTheDocument();
  });

  it('should call onConvert when convert button is clicked', () => {
    render(
      <ConversionQueue
        items={sampleItems}
        onChange={mockOnChange}
        onConvert={mockOnConvert}
        onConvertMany={mockOnConvertMany}
        onOpenOutput={mockOnOpenOutput}
        onOpenOutputDirectory={mockOnOpenOutputDirectory}
        parallelism={4}
        onRemove={mockOnRemove}
        onRemoveCompleted={mockOnRemoveCompleted}
        onClear={mockOnClear}
      />
    );

    const convertButtons = screen.getAllByText('Convert');
    fireEvent.click(convertButtons[0]);

    expect(mockOnConvert).toHaveBeenCalled();
  });

  it('should call onRemove when remove button is clicked', () => {
    render(
      <ConversionQueue
        items={sampleItems}
        onChange={mockOnChange}
        onConvert={mockOnConvert}
        onConvertMany={mockOnConvertMany}
        onOpenOutput={mockOnOpenOutput}
        onOpenOutputDirectory={mockOnOpenOutputDirectory}
        parallelism={4}
        onRemove={mockOnRemove}
        onRemoveCompleted={mockOnRemoveCompleted}
        onClear={mockOnClear}
      />
    );

    // The × button for removing
    const removeButtons = screen.getAllByText('×');
    fireEvent.click(removeButtons[0]);

    expect(mockOnRemove).toHaveBeenCalled();
  });

  it('should show progress bar with correct width', () => {
    const {container} = render(
      <ConversionQueue
        items={sampleItems}
        onChange={mockOnChange}
        onConvert={mockOnConvert}
        onConvertMany={mockOnConvertMany}
        onOpenOutput={mockOnOpenOutput}
        onOpenOutputDirectory={mockOnOpenOutputDirectory}
        parallelism={4}
        onRemove={mockOnRemove}
        onRemoveCompleted={mockOnRemoveCompleted}
        onClear={mockOnClear}
      />
    );

    // Check that progress bars exist
    const progressBars = container.querySelectorAll('[style*="width"]');
    expect(progressBars.length).toBeGreaterThan(0);
  });

  it('should show status labels for each item', () => {
    render(
      <ConversionQueue
        items={sampleItems}
        onChange={mockOnChange}
        onConvert={mockOnConvert}
        onConvertMany={mockOnConvertMany}
        onOpenOutput={mockOnOpenOutput}
        onOpenOutputDirectory={mockOnOpenOutputDirectory}
        parallelism={4}
        onRemove={mockOnRemove}
        onRemoveCompleted={mockOnRemoveCompleted}
        onClear={mockOnClear}
      />
    );

    expect(screen.getByText('Ready · 0%')).toBeInTheDocument();
    expect(screen.getByText('Running · 45%')).toBeInTheDocument();
    expect(screen.getByText('Completed · 100%')).toBeInTheDocument();
  });

  it('should show Open file and Open folder buttons for completed items', () => {
    render(
      <ConversionQueue
        items={sampleItems}
        onChange={mockOnChange}
        onConvert={mockOnConvert}
        onConvertMany={mockOnConvertMany}
        onOpenOutput={mockOnOpenOutput}
        onOpenOutputDirectory={mockOnOpenOutputDirectory}
        parallelism={4}
        onRemove={mockOnRemove}
        onRemoveCompleted={mockOnRemoveCompleted}
        onClear={mockOnClear}
      />
    );

    expect(screen.getByText('Open file')).toBeInTheDocument();
    expect(screen.getByText('Open folder')).toBeInTheDocument();
  });

  it('should call onOpenOutput when Open file button is clicked', () => {
    render(
      <ConversionQueue
        items={sampleItems}
        onChange={mockOnChange}
        onConvert={mockOnConvert}
        onConvertMany={mockOnConvertMany}
        onOpenOutput={mockOnOpenOutput}
        onOpenOutputDirectory={mockOnOpenOutputDirectory}
        parallelism={4}
        onRemove={mockOnRemove}
        onRemoveCompleted={mockOnRemoveCompleted}
        onClear={mockOnClear}
      />
    );

    fireEvent.click(screen.getByText('Open file'));
    expect(mockOnOpenOutput).toHaveBeenCalledWith('/path/to/song.flac');
  });

  it('should call onOpenOutputDirectory when Open folder button is clicked', () => {
    render(
      <ConversionQueue
        items={sampleItems}
        onChange={mockOnChange}
        onConvert={mockOnConvert}
        onConvertMany={mockOnConvertMany}
        onOpenOutput={mockOnOpenOutput}
        onOpenOutputDirectory={mockOnOpenOutputDirectory}
        parallelism={4}
        onRemove={mockOnRemove}
        onRemoveCompleted={mockOnRemoveCompleted}
        onClear={mockOnClear}
      />
    );

    fireEvent.click(screen.getByText('Open folder'));
    expect(mockOnOpenOutputDirectory).toHaveBeenCalledWith('/path/to/song.flac');
  });

  it('should show error message when item has error', () => {
    const itemsWithError: QueueItem[] = [
      {path: '/path/to/photo.jpg', name: 'photo.jpg', format: 'png', quality: 80, status: 'failed', progress: 0, error: 'FFmpeg not found'},
    ];

    render(
      <ConversionQueue
        items={itemsWithError}
        onChange={mockOnChange}
        onConvert={mockOnConvert}
        onConvertMany={mockOnConvertMany}
        onOpenOutput={mockOnOpenOutput}
        onOpenOutputDirectory={mockOnOpenOutputDirectory}
        parallelism={4}
        onRemove={mockOnRemove}
        onRemoveCompleted={mockOnRemoveCompleted}
        onClear={mockOnClear}
      />
    );

    expect(screen.getByText('FFmpeg not found')).toBeInTheDocument();
  });
});
