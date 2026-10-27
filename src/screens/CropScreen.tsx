import {useCallback, useEffect, useRef, useState, type PointerEvent} from 'react';
import {readFile} from '@tauri-apps/plugin-fs';
import {useTranslation} from 'react-i18next';
import {DropZone} from '../components/DropZone';
import {detectFileType, enqueueCrop, subscribeToProgress, type JobUpdate} from '../lib/media';

type CropRect = {x: number; y: number; width: number; height: number};
type AspectRatio = 'free' | '1:1' | '4:3' | '16:9';
type CropImage = {path: string; name: string; url: string; width: number; height: number};
type CropStatus = 'ready' | 'running' | 'completed' | 'failed';

const previewableExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'svg']);

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function extension(path: string) {
  return path.match(/\.([^./\\]+)$/)?.[1]?.toLowerCase() || '';
}

function outputForCrop(path: string) {
  const clean = path.replace(/\.[^./\\]*$/, '');
  const ext = path.match(/\.[^./\\]*$/)?.[0] || '';
  return `${clean}-cropped${ext}`;
}

function imagePoint(event: PointerEvent<HTMLDivElement>, image: HTMLImageElement) {
  const bounds = image.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(image.naturalWidth, (event.clientX - bounds.left) * image.naturalWidth / bounds.width)),
    y: Math.max(0, Math.min(image.naturalHeight, (event.clientY - bounds.top) * image.naturalHeight / bounds.height)),
  };
}

function selectionForDrag(
  start: {x: number; y: number},
  end: {x: number; y: number},
  ratio: number | undefined,
  image: Pick<CropImage, 'width' | 'height'>,
): CropRect {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let width = Math.abs(dx);
  let height = Math.abs(dy);

  if (ratio && width > 0 && height > 0) {
    if (width / height > ratio) width = height * ratio;
    else height = width / ratio;

    const roomX = dx >= 0 ? image.width - start.x : start.x;
    const roomY = dy >= 0 ? image.height - start.y : start.y;
    const scale = Math.min(1, roomX / width, roomY / height);
    width *= scale;
    height *= scale;
  }

  return {
    x: Math.round(dx >= 0 ? start.x : start.x - width),
    y: Math.round(dy >= 0 ? start.y : start.y - height),
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height)),
  };
}

function mimeTypeFor(path: string) {
  switch (extension(path)) {
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'avif': return 'image/avif';
    case 'gif': return 'image/gif';
    case 'bmp': return 'image/bmp';
    case 'svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

export function CropScreen() {
  const {t} = useTranslation();
  const [image, setImage] = useState<CropImage | null>(null);
  const [selection, setSelection] = useState<CropRect | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('free');
  const [status, setStatus] = useState<CropStatus>('ready');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef<{x: number; y: number} | null>(null);
  const jobPaths = useRef<Record<string, string>>({});
  const pendingUpdates = useRef<Record<string, JobUpdate>>({});

  useEffect(() => {
    if (!image?.url) return;
    return () => URL.revokeObjectURL(image.url);
  }, [image?.url]);

  const applyUpdate = useCallback((update: JobUpdate, path: string) => {
    if (image?.path !== path) return;
    setStatus(update.status);
    setProgress(update.progress);
    setError(update.error ?? null);
    if (update.outputPath) setOutputPath(update.outputPath);
  }, [image?.path]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    subscribeToProgress((update) => {
      const path = jobPaths.current[update.id];
      if (!path) {
        pendingUpdates.current[update.id] = update;
        return;
      }
      applyUpdate(update, path);
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    }).catch((reason) => console.error(reason));

    return () => {
      active = false;
      unlisten?.();
    };
  }, [applyUpdate]);

  const addFiles = useCallback(async (paths: string[]) => {
    const path = paths[0];
    if (!path) return;

    if (detectFileType(path) !== 'image' || !previewableExtensions.has(extension(path))) {
      setError(t('cropUnsupportedImage'));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const bytes = await readFile(path);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], {type: mimeTypeFor(path)}));
      setImage({path, name: basename(path), url, width: 0, height: 0});
      setSelection(null);
      setStatus('ready');
      setProgress(0);
      setOutputPath(null);
    } catch (reason) {
      setError(t('cropPreviewError', {error: String(reason)}));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const currentRatio = aspectRatio === 'free' ? undefined : aspectRatio === '1:1' ? 1 : aspectRatio === '4:3' ? 4 / 3 : 16 / 9;

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!image || !imageRef.current || event.button !== 0) return;
    const start = imagePoint(event, imageRef.current);
    dragStart.current = start;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelection({x: start.x, y: start.y, width: 0, height: 0});
  };

  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current || !image || !imageRef.current) return;
    setSelection(selectionForDrag(dragStart.current, imagePoint(event, imageRef.current), currentRatio, image));
  };

  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current || !image || !imageRef.current) return;
    setSelection(selectionForDrag(dragStart.current, imagePoint(event, imageRef.current), currentRatio, image));
    dragStart.current = null;
  };

  const crop = useCallback(async () => {
    if (!image || !selection || selection.width < 1 || selection.height < 1) return;
    setStatus('running');
    setProgress(0);
    setError(null);
    setOutputPath(null);
    try {
      const id = await enqueueCrop({
        inputPath: image.path,
        outputPath: outputForCrop(image.path),
        x: selection.x,
        y: selection.y,
        width: selection.width,
        height: selection.height,
      });
      jobPaths.current[id] = image.path;
      const early = pendingUpdates.current[id];
      if (early) {
        delete pendingUpdates.current[id];
        applyUpdate(early, image.path);
      }
    } catch (reason) {
      setStatus('failed');
      setError(String(reason));
    }
  }, [applyUpdate, image, selection]);

  const hasSelection = Boolean(selection && selection.width > 0 && selection.height > 0);

  return (
    <>
      <header className="mb-8">
        <h1 className="text-xl font-bold tracking-tight">{t('cropTitle')}</h1>
        <p className="text-sm text-zinc-500">{t('cropDescription')}</p>
      </header>

      <DropZone onFiles={addFiles} imageOnly/>

      {loading && <p className="mt-4 text-sm text-zinc-400">{t('cropLoading')}</p>}
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}

      {image && <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-medium">{image.name}</h2>
            <p className="mt-1 text-xs text-zinc-500">{image.width > 0 ? `${image.width} × ${image.height} px` : image.path}</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            {t('cropRatio')}
            <select value={aspectRatio} onChange={(event) => { setAspectRatio(event.target.value as AspectRatio); setSelection(null); }} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100">
              <option value="free">{t('cropRatioFree')}</option>
              <option value="1:1">1:1</option>
              <option value="4:3">4:3</option>
              <option value="16:9">16:9</option>
            </select>
          </label>
        </div>

        <div className="flex min-h-56 items-center justify-center overflow-auto rounded-xl bg-[linear-gradient(45deg,#18181b_25%,transparent_25%),linear-gradient(-45deg,#18181b_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#18181b_75%),linear-gradient(-45deg,transparent_75%,#18181b_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0] p-3">
          <div
            className="relative inline-block max-w-full cursor-crosshair touch-none select-none"
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
          >
            <img
              ref={imageRef}
              src={image.url}
              alt={image.name}
              draggable={false}
              onLoad={() => {
                if (!imageRef.current) return;

                setImage((current) => current?.path === image.path ? {
                  ...current,
                  width: imageRef.current!.naturalWidth,
                  height: imageRef.current!.naturalHeight
                } : current)
              }}
              onError={() => setError(t('cropImageDecodeError'))}
              className="block max-h-[55vh] max-w-full rounded-lg object-contain"
            />
            {hasSelection && image.width > 0 && image.height > 0 && <div
              aria-hidden="true"
              className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_9999px_rgba(9,9,11,0.58)]"
              style={{
                left: `${(selection!.x / image.width) * 100}%`,
                top: `${(selection!.y / image.height) * 100}%`,
                width: `${(selection!.width / image.width) * 100}%`,
                height: `${(selection!.height / image.height) * 100}%`,
              }}
            />}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-zinc-400">
            {hasSelection ? <>{t('cropSelection')}: <span className="font-medium text-zinc-200">{selection!.width} × {selection!.height} px</span></> : t('cropDragHint')}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSelection(null)} disabled={!hasSelection || status === 'running'} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40">{t('cropReset')}</button>
            <button type="button" onClick={() => void crop()} disabled={!hasSelection || status === 'running' || image.width === 0} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">{status === 'running' ? `${t('statusRunning')} · ${progress}%` : t('cropSave')}</button>
          </div>
        </div>

        {status === 'running' && <div className="mt-3 flex items-center gap-3" role="status" aria-live="polite">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-violet-500 transition-all" style={{width: `${progress}%`}}/>
          </div>
          <span className="w-28 text-right text-xs text-zinc-400">{t('statusRunning')} · {progress}%</span>
        </div>}

        {status === 'completed' && outputPath && <p className="mt-3 break-all rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">{t('cropSaved')}: {outputPath}</p>}
      </section>}
    </>
  );
}
