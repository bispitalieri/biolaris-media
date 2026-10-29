import {useCallback, useEffect, useRef, useState} from 'react';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faArrowDown, faArrowUp, faImage, faTrash} from '@fortawesome/free-solid-svg-icons';
import {useTranslation} from 'react-i18next';
import {useAppSettings} from '../lib/settings';
import {DropZone} from '../components/DropZone';
import {
  enqueueSlideshow,
  subscribeToProgress,
  type JobUpdate,
  type SlideshowResolution,
} from '../lib/media';

type SlideshowImage = {path: string; name: string; selected: boolean};
type SlideshowStatus = 'ready' | 'running' | 'completed' | 'failed';

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function defaultOutputName(path: string) {
  if (!path) return 'slideshow';
  const name = basename(path).replace(/\.[^./\\]*$/, '');
  return `${name}-slideshow`;
}

export function SlideshowScreen() {
  const {t, i18n} = useTranslation();
  const {settings} = useAppSettings();
  const [images, setImages] = useState<SlideshowImage[]>([]);
  const [resolution, setResolution] = useState<SlideshowResolution>('1080p');
  const [secondsPerSlide, setSecondsPerSlide] = useState(3);
  const [outputName, setOutputName] = useState('');
  const [status, setStatus] = useState<SlideshowStatus>('ready');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const jobId = useRef<string | null>(null);
  const pendingUpdates = useRef<Record<string, JobUpdate>>({});
  const selectedImages = images.filter((image) => image.selected);
  const isRunning = status === 'running';
  const totalSeconds = selectedImages.length * secondsPerSlide;
  const formatNumber = (value: number) => new Intl.NumberFormat(i18n.language, {maximumFractionDigits: 1}).format(value);

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

  const addFiles = useCallback((paths: string[]) => {
    setImages((current) => {
      const existing = new Set(current.map((image) => image.path));
      const additions: SlideshowImage[] = [];
      for (const path of paths) {
        if (existing.has(path)) continue;
        existing.add(path);
        additions.push({path, name: basename(path), selected: true});
      }
      return [...current, ...additions];
    });
    setError(null);
    setOutputPath(null);
    setStatus((current) => current === 'failed' || current === 'completed' ? 'ready' : current);
    setProgress(0);
  }, []);

  const updateSelection = (path: string, selected: boolean) => {
    setImages((current) => current.map((image) => image.path === path ? {...image, selected} : image));
    setOutputPath(null);
    setError(null);
    setProgress(0);
    setStatus((current) => current === 'completed' || current === 'failed' ? 'ready' : current);
  };

  const removeImage = (path: string) => {
    setImages((current) => current.filter((image) => image.path !== path));
    setOutputPath(null);
    setError(null);
    setProgress(0);
    setStatus((current) => current === 'completed' || current === 'failed' ? 'ready' : current);
  };

  const moveImage = (path: string, direction: -1 | 1) => {
    setImages((current) => {
      const index = current.findIndex((image) => image.path === path);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    setOutputPath(null);
    setError(null);
    setProgress(0);
    setStatus((current) => current === 'completed' || current === 'failed' ? 'ready' : current);
  };

  const clear = () => {
    setImages([]);
    setStatus('ready');
    setProgress(0);
    setError(null);
    setOutputPath(null);
  };

  const createSlideshow = async () => {
    if (isRunning || !selectedImages.length) return;
    setStatus('running');
    setProgress(0);
    setError(null);
    setOutputPath(null);
    jobId.current = null;
    try {
      const id = await enqueueSlideshow({
        imagePaths: selectedImages.map((image) => image.path),
        outputName: outputName.trim(),
        resolution,
        secondsPerSlide,
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

  const statusLabel = status === 'running' ? t('statusRunning')
    : status === 'completed' ? t('statusCompleted')
      : status === 'failed' ? t('statusFailed') : t('statusReady');

  return (
    <>
      <header className="mb-8">
        <h1 className="text-xl font-bold tracking-tight">{t('slideshowTitle')}</h1>
        <p className="text-sm text-zinc-500">{t('slideshowDescription')}</p>
      </header>

      <DropZone onFiles={addFiles} imageOnly multiple/>

      <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5" aria-label={t('slideshowSettings')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium">
            <span>{t('slideshowResolution')}</span>
            <select value={resolution} onChange={(event) => setResolution(event.target.value as SlideshowResolution)} disabled={isRunning} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 disabled:opacity-50">
              <option value="720p">720p · 1280 × 720</option>
              <option value="1080p">1080p · 1920 × 1080</option>
              <option value="4k">4K · 3840 × 2160</option>
              <option value="match-image">{t('slideshowMatchImage')}</option>
            </select>
          </label>

          <label className="flex flex-col gap-2 text-sm font-medium">
            <span className="flex items-center justify-between gap-3">
              <span>{t('slideshowSecondsPerImage')}</span>
              <span className="rounded-md bg-zinc-800 px-2 py-1 text-xs font-normal text-zinc-300">{formatNumber(secondsPerSlide)} sec</span>
            </span>
            <input
              aria-label={t('slideshowSecondsPerImage')}
              type="range"
              min="1"
              max="30"
              step="0.5"
              value={secondsPerSlide}
              disabled={isRunning}
              onChange={(event) => setSecondsPerSlide(Number(event.target.value))}
              className="mt-2 w-full accent-violet-500 disabled:opacity-50"
            />
            <span className="flex justify-between text-xs font-normal text-zinc-500"><span>1 sec</span><span>30 sec</span></span>
          </label>

          <label className="flex flex-col gap-2 text-sm font-medium">
            <span>{t('slideshowOutputName')}</span>
            <span className="flex">
              <input
                type="text"
                value={outputName}
                maxLength={240}
                disabled={isRunning}
                placeholder={defaultOutputName(selectedImages[0]?.path ?? images[0]?.path ?? '')}
                onChange={(event) => setOutputName(event.target.value.replace(/\.mp4$/i, ''))}
                className="min-w-0 flex-1 rounded-l-lg border border-r-0 border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 disabled:opacity-50"
              />
              <span aria-hidden="true" className="inline-flex items-center rounded-r-lg border border-zinc-700 bg-zinc-700/70 px-3 text-sm text-zinc-300">.mp4</span>
            </span>
          </label>
        </div>
        <p className="mt-4 rounded-lg bg-zinc-950/60 px-3 py-2 text-sm text-zinc-400">
          {t('slideshowDurationEstimate', {
            count: selectedImages.length,
            seconds: formatNumber(secondsPerSlide),
            total: formatNumber(totalSeconds),
          })}
        </p>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t('slideshowImages')}</h2>
            <p className="text-sm text-zinc-400">{t('slideshowSelectedCount', {selected: selectedImages.length, total: images.length})}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={clear} disabled={!images.length || isRunning} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40">{t('clear')}</button>
            <button type="button" onClick={() => void createSlideshow()} disabled={!selectedImages.length || isRunning} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">
              {isRunning ? t('slideshowCreating') : t('createSlideshow')}
            </button>
          </div>
        </div>

        {images.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 p-8 text-center text-sm text-zinc-500">{t('slideshowEmpty')}</div>
        ) : (
          <div className="space-y-2">
            {images.map((image, index) => (
              <article key={image.path} className={`flex items-center gap-3 rounded-xl border px-3 py-3 transition ${image.selected ? 'border-violet-700/50 bg-violet-950/20' : 'border-zinc-800 bg-zinc-900/60'}`}>
                <input type="checkbox" aria-label={t('slideshowSelectImage', {name: image.name})} checked={image.selected} disabled={isRunning} onChange={(event) => updateSelection(image.path, event.target.checked)} className="h-4 w-4 accent-violet-500 disabled:opacity-50"/>
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-zinc-800 text-zinc-400"><FontAwesomeIcon icon={faImage}/></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{image.name}</p>
                  <p className="truncate text-xs text-zinc-500">{image.path}</p>
                </div>
                <span className="hidden text-xs text-zinc-500 sm:inline">{index + 1}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" aria-label={t('slideshowMoveUp', {name: image.name})} onClick={() => moveImage(image.path, -1)} disabled={index === 0 || isRunning} className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"><FontAwesomeIcon icon={faArrowUp} className="text-xs"/></button>
                  <button type="button" aria-label={t('slideshowMoveDown', {name: image.name})} onClick={() => moveImage(image.path, 1)} disabled={index === images.length - 1 || isRunning} className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"><FontAwesomeIcon icon={faArrowDown} className="text-xs"/></button>
                  <button type="button" aria-label={t('removeFile', {name: image.name})} onClick={() => removeImage(image.path)} disabled={isRunning} className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 hover:bg-red-950/60 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"><FontAwesomeIcon icon={faTrash} className="text-xs"/></button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {(isRunning || status === 'completed') && <section className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4" aria-live="polite">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>{statusLabel}</span>
          <span className="text-zinc-400">{progress}%</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full rounded-full bg-violet-500 transition-all" style={{width: `${progress}%`}}/>
        </div>
        {outputPath && <p className="mt-3 break-all text-xs text-zinc-400">{t('slideshowOutput')}: {outputPath}</p>}
      </section>}
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}
    </>
  );
}
