import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faArrowDown, faArrowUp, faGripVertical, faLock, faTrash} from '@fortawesome/free-solid-svg-icons';
import {useTranslation} from 'react-i18next';
import {useAppSettings} from '../lib/settings';
import {DropZone} from '../components/DropZone';
import {
  enqueueImagesToPdf,
  previewImageForPdf,
  subscribeToProgress,
  type ImageToPdfPreview,
  type ImagesToPdfPageSize,
  type JobUpdate,
} from '../lib/media';

type PdfImage = {
  path: string;
  name: string;
  preview: ImageToPdfPreview | null;
  error?: string;
};
type JobStatus = 'ready' | 'running' | 'completed' | 'failed';

const imageExtensions = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff'];
const qualityStorageKey = 'biolaris-images-to-pdf-quality';
const basename = (path: string) => path.split(/[\\/]/).pop() || path;

function loadQuality() {
  try {
    const saved = Number(window.localStorage.getItem(qualityStorageKey));
    return Number.isInteger(saved) && saved >= 40 && saved <= 100 ? saved : 85;
  } catch {
    return 85;
  }
}

function pageDimensions(
  pageSize: ImagesToPdfPageSize,
  customWidth: number,
  customHeight: number,
  image: PdfImage,
) {
  if (pageSize === 'fit-to-image' && image.preview) {
    return {width: image.preview.width, height: image.preview.height};
  }
  const [width, height] = pageSize === 'a4' ? [210, 297]
    : pageSize === 'letter' ? [215.9, 279.4]
      : [Number.isFinite(customWidth) ? Math.max(10, Math.min(2000, customWidth)) : 210,
        Number.isFinite(customHeight) ? Math.max(10, Math.min(2000, customHeight)) : 297];
  if (!image.preview) return {width, height};
  return (image.preview.width > image.preview.height) === (width > height)
    ? {width, height}
    : {width: height, height: width};
}

export function ImagesToPdfScreen() {
  const {t} = useTranslation();
  const {settings} = useAppSettings();
  const [images, setImages] = useState<PdfImage[]>([]);
  const [pageSize, setPageSize] = useState<ImagesToPdfPageSize>('fit-to-image');
  const [customWidth, setCustomWidth] = useState(210);
  const [customHeight, setCustomHeight] = useState(297);
  const [quality, setQuality] = useState(loadQuality);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<JobStatus>('ready');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsPosition, setOptionsPosition] = useState({left: 0, top: 0});
  const [draggedImagePath, setDraggedImagePath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{path: string; after: boolean} | null>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const optionsPanelRef = useRef<HTMLDivElement>(null);
  const dragSession = useRef<{path: string} | null>(null);
  const jobId = useRef<string | null>(null);
  const pendingUpdates = useRef<Record<string, JobUpdate>>({});
  const running = status === 'running';
  const loadingPreviews = images.some((image) => !image.preview && !image.error);
  const hasInvalidImages = images.some((image) => image.error);
  const canCreate = images.length > 0 && !loadingPreviews && !hasInvalidImages && !running;
  const invalidCustomSize = pageSize === 'custom'
    && (![customWidth, customHeight].every(Number.isFinite)
      || customWidth < 10 || customWidth > 2000 || customHeight < 10 || customHeight > 2000);

  const updateOptionsPosition = useCallback(() => {
    const button = optionsButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const panelWidth = optionsPanelRef.current?.offsetWidth ?? 320;
    const center = rect.left + rect.width / 2;
    setOptionsPosition({
      left: Math.max(16 + panelWidth / 2, Math.min(center, window.innerWidth - 16 - panelWidth / 2)),
      top: rect.bottom - 18,
    });
  }, []);

  useLayoutEffect(() => {
    if (optionsOpen) updateOptionsPosition();
  }, [optionsOpen, updateOptionsPosition]);

  useEffect(() => {
    if (!optionsOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)
        || optionsButtonRef.current?.contains(target)
        || optionsPanelRef.current?.contains(target)) return;
      setOptionsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOptionsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', updateOptionsPosition);
    window.addEventListener('scroll', updateOptionsPosition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', updateOptionsPosition);
      window.removeEventListener('scroll', updateOptionsPosition, true);
    };
  }, [optionsOpen, updateOptionsPosition]);

  useEffect(() => {
    if (!draggedImagePath) return;
    const getDropTarget = (event: PointerEvent) => {
      const row = document.elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-image-path]');
      if (!row?.dataset.imagePath) return null;
      const rect = row.getBoundingClientRect();
      return {
        path: row.dataset.imagePath,
        after: event.clientY >= rect.top + rect.height / 2,
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      const target = getDropTarget(event);
      setDropTarget(target);
    };
    const onPointerUp = (event: PointerEvent) => {
      const target = getDropTarget(event);
      const source = dragSession.current?.path;
      if (source && target) {
        setImages((current) => {
          const from = current.findIndex((image) => image.path === source);
          const to = current.findIndex((image) => image.path === target.path);
          if (from < 0 || to < 0 || from === to) return current;
          const next = [...current];
          const [moved] = next.splice(from, 1);
          const targetIndex = next.findIndex((image) => image.path === target.path);
          next.splice(targetIndex + (target.after ? 1 : 0), 0, moved);
          return next;
        });
        resetResult();
      }
      dragSession.current = null;
      setDraggedImagePath(null);
      setDropTarget(null);
    };
    const onPointerCancel = () => {
      dragSession.current = null;
      setDraggedImagePath(null);
      setDropTarget(null);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [draggedImagePath]);

  useEffect(() => {
    try {
      window.localStorage.setItem(qualityStorageKey, String(quality));
    } catch {
      // Quality still applies for this session when browser storage is unavailable.
    }
  }, [quality]);

  const applyUpdate = useCallback((update: JobUpdate) => {
    setStatus(update.status);
    setProgress(update.progress);
    setError(update.error ?? null);
    if (update.outputPath) setOutputPath(update.outputPath);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    subscribeToProgress((update) => {
      if (update.id !== jobId.current) {
        pendingUpdates.current[update.id] = update;
        return;
      }
      applyUpdate(update);
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    }).catch((reason) => console.error(reason));
    return () => {
      active = false;
      unlisten?.();
    };
  }, [applyUpdate]);

  const resetResult = () => {
    setError(null);
    setOutputPath(null);
    setProgress(0);
    setStatus((current) => current === 'completed' || current === 'failed' ? 'ready' : current);
  };

  const addImages = useCallback((paths: string[]) => {
    if (running) return;
    const existing = new Set(images.map(({path}) => path));
    const additions = paths
      .filter((path) => !existing.has(path))
      .map((path) => ({path, name: basename(path), preview: null}));
    if (!additions.length) return;
    setImages((current) => {
      const currentPaths = new Set(current.map(({path}) => path));
      return [...current, ...additions.filter(({path}) => !currentPaths.has(path))];
    });
    resetResult();
    for (const {path} of additions) {
      void previewImageForPdf(path).then((preview) => {
        setImages((current) => current.map((image) => image.path === path
          ? {...image, preview, error: undefined}
          : image));
      }).catch((reason: unknown) => {
        setImages((current) => current.map((image) => image.path === path
          ? {...image, error: String(reason)}
          : image));
      });
    }
  }, [images, running]);

  const moveImage = (from: number, to: number) => {
    if (from === to || to < 0 || to >= images.length) return;
    setImages((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    resetResult();
  };

  const removeImage = (path: string) => {
    setImages((current) => current.filter((image) => image.path !== path));
    resetResult();
  };

  const createPdf = async () => {
    if (!canCreate || invalidCustomSize) return;
    setStatus('running');
    setProgress(0);
    setError(null);
    setOutputPath(null);
    jobId.current = null;
    try {
      const id = await enqueueImagesToPdf({
        imagePaths: images.map((image) => image.path),
        pageSize,
        customWidthMm: customWidth,
        customHeightMm: customHeight,
        quality,
        password: password || null,
        autoRenameOutputs: settings.general.autoRenameOutputs,
      });
      jobId.current = id;
      const early = pendingUpdates.current[id];
      if (early) {
        delete pendingUpdates.current[id];
        applyUpdate(early);
      }
    } catch (reason) {
      setStatus('failed');
      setError(String(reason));
    }
  };

  const statusLabel = status === 'running' ? t('imagesToPdfRunning')
    : status === 'completed' ? t('statusCompleted')
      : status === 'failed' ? t('statusFailed') : t('statusReady');

  return <>
    <header className="mb-8">
      <h1 className="text-xl font-bold tracking-tight">{t('imagesToPdfTitle')}</h1>
      <p className="text-sm text-zinc-500">{t('imagesToPdfDescription')}</p>
    </header>

    <DropZone
      onFiles={addImages}
      allowedExtensions={imageExtensions}
      multiple
      title={t('imagesToPdfDropTitle')}
      description={t('imagesToPdfDropDescription')}
    />

    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('imagesToPdfList')}</h2>
          <p className="text-sm text-zinc-400">{t('imagesToPdfCount', {count: images.length})}</p>
          <p className="text-xs text-zinc-500">{t('imagesToPdfListHint')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setImages([]); resetResult(); }}
            disabled={!images.length || running}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40">
            {t('clear')}
          </button>
          <button ref={optionsButtonRef} type="button" aria-expanded={optionsOpen} aria-haspopup="dialog"
            onClick={() => setOptionsOpen((open) => !open)}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
            {t('imagesToPdfOptions')}
          </button>
          {optionsOpen && createPortal(
            <div ref={optionsPanelRef} role="dialog" aria-label={t('imagesToPdfOptions')}
              style={{left: optionsPosition.left, top: optionsPosition.top}}
              className="fixed z-[1000] w-80 max-w-[calc(100vw-2rem)] space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-xl">
              <label className="flex flex-col gap-2 text-sm font-medium">
                <span>{t('imagesToPdfPageSize')}</span>
                <select value={pageSize} disabled={running}
                  onChange={(event) => {
                    setPageSize(event.target.value as ImagesToPdfPageSize);
                    resetResult();
                  }}
                  className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 disabled:opacity-50">
                  <option value="fit-to-image">{t('imagesToPdfFitImage')}</option>
                  <option value="a4">{t('imagesToPdfA4')}</option>
                  <option value="letter">{t('imagesToPdfLetter')}</option>
                  <option value="custom">{t('imagesToPdfCustom')}</option>
                </select>
              </label>
              {pageSize === 'custom' && <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-2 text-sm">
                  <span>{t('imagesToPdfWidthMm')}</span>
                  <input type="number" min="10" max="2000" step="1" value={customWidth} disabled={running}
                    onChange={(event) => { setCustomWidth(Number(event.target.value)); resetResult(); }}
                    className="min-w-0 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 disabled:opacity-50"/>
                </label>
                <label className="flex flex-col gap-2 text-sm">
                  <span>{t('imagesToPdfHeightMm')}</span>
                  <input type="number" min="10" max="2000" step="1" value={customHeight} disabled={running}
                    onChange={(event) => { setCustomHeight(Number(event.target.value)); resetResult(); }}
                    className="min-w-0 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 disabled:opacity-50"/>
                </label>
                {invalidCustomSize && <p className="col-span-2 text-xs text-red-300">{t('imagesToPdfCustomLimit')}</p>}
              </div>}
              <label className="flex flex-col gap-2 text-sm">
                <span className="flex items-center justify-between gap-3">
                  <span>{t('imagesToPdfQuality')}</span>
                  <span className="rounded-md bg-zinc-800 px-2 py-1 text-xs font-normal text-zinc-300">{quality}%</span>
                </span>
                <input type="range" min="40" max="100" step="1" value={quality} disabled={running}
                  onChange={(event) => { setQuality(Number(event.target.value)); resetResult(); }}
                  className="w-full accent-violet-500 disabled:opacity-50"/>
                <span className="text-xs font-normal text-zinc-500">{t('imagesToPdfQualityHint')}</span>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium">
                <span className="flex items-center gap-2"><FontAwesomeIcon icon={faLock}/>{t('imagesToPdfPassword')}</span>
                <input type="password" maxLength={32} autoComplete="new-password" value={password} disabled={running}
                  onChange={(event) => { setPassword(event.target.value); resetResult(); }}
                  placeholder={t('imagesToPdfPasswordPlaceholder')}
                  className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 disabled:opacity-50"/>
                <span className="text-xs font-normal text-zinc-500">{t('imagesToPdfPasswordHint')}</span>
              </label>
            </div>,
            document.body,
          )}
          <button type="button" onClick={() => void createPdf()}
            disabled={!canCreate || invalidCustomSize}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">
            {running ? t('imagesToPdfRunning') : t('imagesToPdfAction')}
          </button>
        </div>
      </div>

      {images.length === 0 ? <div className="rounded-xl border border-zinc-800 p-8 text-center text-sm text-zinc-500">{t('imagesToPdfEmpty')}</div>
        : <div className="space-y-2" onContextMenu={(event) => event.preventDefault()}>
          {images.map((image, index) => {
            const page = pageDimensions(pageSize, customWidth, customHeight, image);
            const scale = Math.min(96 / page.width, 80 / page.height);
            const isDropTarget = dropTarget?.path === image.path && draggedImagePath !== image.path;
            return <article key={image.path} data-image-path={image.path}
              className={`relative flex items-center gap-3 rounded-xl border bg-zinc-900/60 px-3 py-3 transition ${
                draggedImagePath === image.path ? 'scale-[0.99] border-violet-500 opacity-40' : 'border-zinc-800'
              } ${isDropTarget ? 'border-violet-400 bg-violet-950/30' : ''}`}>
              {isDropTarget && <span aria-hidden="true"
                className={`absolute inset-x-2 h-0.5 rounded bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.8)] ${
                  dropTarget.after ? '-bottom-1' : '-top-1'
                }`}/>}
              <span
                onPointerDown={(event) => {
                  if (running || event.button !== 0) return;
                  event.preventDefault();
                  dragSession.current = {path: image.path};
                  setDraggedImagePath(image.path);
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                title={t('imagesToPdfListHint')}
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-md touch-none text-zinc-600 ${
                  running ? 'cursor-not-allowed' : 'cursor-grab hover:bg-zinc-800 active:cursor-grabbing'
                }`}>
                <FontAwesomeIcon icon={faGripVertical}/>
              </span>
              <div className="flex h-20 w-24 shrink-0 items-center justify-center">
                <div className="relative overflow-hidden border border-zinc-300 bg-white shadow-sm"
                  style={{width: `${page.width * scale}px`, height: `${page.height * scale}px`}}>
                  {image.preview && <img src={image.preview.dataUrl} alt="" draggable={false}
                    className="h-full w-full object-contain"/>}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{image.name}</p>
                <p className="truncate text-xs text-zinc-500">{image.path}</p>
                {!image.preview && !image.error && <p className="mt-1 text-xs text-zinc-400">{t('imagesToPdfPreviewLoading')}</p>}
                {image.error && <p className="mt-1 break-words text-xs text-red-300">{t('imagesToPdfPreviewError', {error: image.error})}</p>}
                {image.preview && <p className="mt-1 text-xs text-zinc-500">{image.preview.width} × {image.preview.height} px</p>}
              </div>
              <span className="hidden text-xs text-zinc-500 sm:inline">{index + 1}</span>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" aria-label={t('imagesToPdfMoveUp', {name: image.name})}
                  onClick={() => moveImage(index, index - 1)} disabled={index === 0 || running}
                  className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-30">
                  <FontAwesomeIcon icon={faArrowUp} className="text-xs"/>
                </button>
                <button type="button" aria-label={t('imagesToPdfMoveDown', {name: image.name})}
                  onClick={() => moveImage(index, index + 1)} disabled={index === images.length - 1 || running}
                  className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-30">
                  <FontAwesomeIcon icon={faArrowDown} className="text-xs"/>
                </button>
                <button type="button" aria-label={t('removeFile', {name: image.name})}
                  onClick={() => removeImage(image.path)} disabled={running}
                  className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 hover:bg-red-950/60 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30">
                  <FontAwesomeIcon icon={faTrash} className="text-xs"/>
                </button>
              </div>
            </article>;
          })}
        </div>}
    </section>

    {(running || status === 'completed') && <section className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{statusLabel}</span><span className="text-zinc-400">{progress}%</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-violet-500 transition-all" style={{width: `${progress}%`}}/>
      </div>
      {outputPath && <p className="mt-3 break-all text-xs text-zinc-400">{t('imagesToPdfOutput')}: {outputPath}</p>}
    </section>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}
  </>;
}
