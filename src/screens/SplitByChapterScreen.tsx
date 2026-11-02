import {useCallback, useEffect, useRef, useState} from 'react';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {convertFileSrc} from '@tauri-apps/api/core';
import {faBookOpen, faFolderOpen, faPause, faPlay} from '@fortawesome/free-solid-svg-icons';
import {useTranslation} from 'react-i18next';
import {useAppSettings} from '../lib/settings';
import {DropZone} from '../components/DropZone';
import {
  enqueueSplitByChapter,
  openOutputDirectory,
  prepareAudioPreview,
  probeChapters,
  subscribeToProgress,
  type ChapterFileInfo,
  type ChapterOutputFormat,
  type JobUpdate
} from '../lib/media';

type Status = 'ready' | 'running' | 'completed' | 'failed';
type Selection = {path: string; name: string};
type ChapterPreview = {index: number; start: number; end: number};
const supportedExtensions = [
  'mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'f4v', 'vob', 'ogv', 'ogm', 'qt',
  'm4v', 'mpg', 'mpeg', 'm2v', '3gp', '3g2', 'ts', 'mts', 'm2ts', 'm2t', 'asf', 'rm',
  'rmvb', 'divx', 'xvid', 'dv', 'amv', 'mjpeg', 'mjpg', 'roq', 'yuv', 'nut',
  'mp3', 'wav', 'ogg', 'oga', 'mka', 'flac', 'm4a', 'm4r', 'aac', 'adts', 'wma',
  'alac', 'aiff', 'aif', 'ape', 'pcm', 'opus', 'spx', 'amr', 'gsm', 'mid', 'midi',
  'm4b', 'm4p', 'mpc', 'wv', 'dsf', 'dff', 'caf', 'tak', 'tta', 'ra', 'ram', 'au', 'snd', 'voc', 'ac3'
];
const audioFormats = ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'aac', 'opus'];
const videoFormats = ['mp4', 'mkv', 'mov', 'webm', 'avi'];
const basename = (path: string) => path.split(/[\\/]/).pop() || path;
const timestamp = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
};

export function SplitByChapterScreen() {
  const {t} = useTranslation();
  const {settings} = useAppSettings();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [info, setInfo] = useState<ChapterFileInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [format, setFormat] = useState<ChapterOutputFormat>('original');
  const [status, setStatus] = useState<Status>('ready');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [outputDirectory, setOutputDirectory] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [playingChapter, setPlayingChapter] = useState<number | null>(null);
  const [loadingChapter, setLoadingChapter] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewRequest = useRef(0);
  const previewRange = useRef<ChapterPreview | null>(null);
  const jobId = useRef<string | null>(null);
  const pending = useRef<Record<string, JobUpdate>>({});
  const requestId = useRef(0);
  const running = status === 'running';
  const availableFormats = info?.hasVideo ? videoFormats : audioFormats;

  const stopPreview = useCallback(() => {
    previewRequest.current++;
    previewRange.current = null;
    audioRef.current?.pause();
    setPlayingChapter(null);
    setLoadingChapter(null);
    setPreviewError(null);
  }, []);

  const toggleChapterPreview = async (chapter: ChapterPreview) => {
    const audio = audioRef.current;
    if (!selection || running || !audio) return;
    if (previewRange.current?.index === chapter.index) {
      if (audio.paused) {
        if (audio.currentTime >= chapter.end || audio.currentTime < chapter.start) {
          audio.currentTime = chapter.start;
        }
        try {
          setPreviewError(null);
          await audio.play();
          setPlayingChapter(chapter.index);
        } catch (reason) {
          setPreviewError(t('splitByChapterPreviewError', {error: String(reason)}));
        }
      } else {
        audio.pause();
      }
      return;
    }

    const request = ++previewRequest.current;
    previewRange.current = null;
    audio.pause();
    setPlayingChapter(null);
    setPreviewError(null);
    setLoadingChapter(chapter.index);
    try {
      const path = await prepareAudioPreview(selection.path);
      if (request !== previewRequest.current) return;
      const source = convertFileSrc(path);
      if (audio.getAttribute('src') !== source || audio.readyState === 0) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            audio.removeEventListener('loadedmetadata', onLoaded);
            audio.removeEventListener('error', onError);
          };
          const onLoaded = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(new Error(t('splitByChapterPreviewUnsupported')));
          };
          audio.addEventListener('loadedmetadata', onLoaded);
          audio.addEventListener('error', onError);
          audio.src = source;
          audio.load();
        });
      }
      if (request !== previewRequest.current) return;
      audio.currentTime = chapter.start;
      previewRange.current = chapter;
      await audio.play();
      setPlayingChapter(chapter.index);
    } catch (reason) {
      if (request === previewRequest.current) {
        previewRange.current = null;
        setPlayingChapter(null);
        setPreviewError(t('splitByChapterPreviewError', {error: String(reason)}));
      }
    } finally {
      if (request === previewRequest.current) setLoadingChapter(null);
    }
  };

  useEffect(() => () => {
    previewRequest.current++;
    audioRef.current?.pause();
  }, []);

  const applyUpdate = useCallback((update: JobUpdate) => {
    setStatus(update.status);
    setProgress(update.progress);
    setError(update.error ?? null);
    if (update.outputPath) setOutputDirectory(update.outputPath);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    subscribeToProgress((update) => {
      if (update.id !== jobId.current) {
        pending.current[update.id] = update;
        return;
      }
      applyUpdate(update);
    }).then((fn) => {
      if (active) unlisten = fn; else fn();
    }).catch(console.error);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [applyUpdate]);

  const selectFiles = useCallback((paths: string[]) => {
    const path = paths[0];
    if (!path || running) {
      if (!path && !running) {
        stopPreview();
        requestId.current++;
        setSelection(null);
        setInfo(null);
        setLoading(false);
        setFormat('original');
        setError(null);
        setOutputDirectory(null);
        setProgress(0);
        setStatus('ready');
      }
      return;
    }
    stopPreview();
    const currentRequest = ++requestId.current;
    setSelection({path, name: basename(path)});
    setInfo(null);
    setFormat('original');
    setLoading(true);
    setError(null);
    setOutputDirectory(null);
    setProgress(0);
    setStatus('ready');
    void probeChapters(path).then((result) => {
      if (currentRequest !== requestId.current) return;
      setInfo(result);
      setLoading(false);
    }).catch((reason: unknown) => {
      if (currentRequest !== requestId.current) return;
      const message = String(reason);
      setError(message.toLowerCase().includes('nessun capitolo')
        ? t('splitByChapterNoChapters')
        : message);
      setLoading(false);
      setStatus('failed');
    });
  }, [running, stopPreview, t]);

  const split = async () => {
    if (!selection || !info?.chapters.length || running) return;
    stopPreview();
    setStatus('running');
    setProgress(0);
    setError(null);
    setOutputDirectory(null);
    jobId.current = null;
    try {
      const id = await enqueueSplitByChapter({
        inputPath: selection.path,
        format,
        autoRenameOutputs: settings.general.autoRenameOutputs
      });
      jobId.current = id;
      if (pending.current[id]) {
        const early = pending.current[id];
        delete pending.current[id];
        applyUpdate(early);
      }
    } catch (reason) {
      setStatus('failed');
      setError(String(reason));
    }
  };

  return <>
    <header className="mb-8">
      <h1 className="text-xl font-bold tracking-tight">{t('splitByChapterTitle')}</h1>
      <p className="text-sm text-zinc-500">{t('splitByChapterDescription')}</p>
    </header>
    <DropZone
      onFiles={selectFiles}
      allowedExtensions={supportedExtensions}
      title={t('splitByChapterDropTitle')}
      description={t('splitByChapterDropDescription')}
    />

    {selection && <section className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-zinc-800 text-zinc-400">
          <FontAwesomeIcon icon={faBookOpen}/>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{selection.name}</p>
          <p className="truncate text-xs text-zinc-500">{selection.path}</p>
        </div>
        {!running && <button type="button" onClick={() => selectFiles([])} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">{t('clear')}</button>}
      </div>
    </section>}

    {loading && <p className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-300" aria-live="polite">{t('splitByChapterLoading')}</p>}
    {info && <section className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm font-medium">
          <span>{t('splitByChapterFormat')}</span>
          <select value={format} disabled={running} onChange={(event) => setFormat(event.target.value as ChapterOutputFormat)} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-zinc-100 disabled:opacity-50">
            <option value="original">{t('splitByChapterOriginal', {format: info.originalFormat.toUpperCase()})}</option>
            {availableFormats.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
          </select>
        </label>
        <div className="flex items-end text-sm text-zinc-400">{t('splitByChapterCount', {count: info.chapters.length})}</div>
      </div>
    </section>}

    {(running || status === 'completed') && <section className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4" aria-live="polite">
      <div className="flex justify-between text-sm">
        <span>{running ? t('splitByChapterRunning') : t('statusCompleted')}</span>
        <span className="text-zinc-400">{progress}%</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-violet-500 transition-all" style={{width: `${progress}%`}}/>
      </div>
      {outputDirectory && <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="break-all text-xs text-zinc-400">{t('splitByChapterOutput')}: {outputDirectory}</p>
        <button type="button" onClick={() => { setOpenError(null); void openOutputDirectory(outputDirectory).catch((reason) => setOpenError(String(reason))); }} className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800">
          <FontAwesomeIcon icon={faFolderOpen}/>{t('openOutputDirectory')}
        </button>
      </div>}
    </section>}
    {openError && <p role="alert" className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{openError}</p>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}

    {info && <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold">{t('splitByChapterList')}</h2><p className="text-sm text-zinc-400">{t('splitByChapterCount', {count: info.chapters.length})}</p></div>
        <button type="button" disabled={running || loading || info.chapters.length === 0} onClick={() => void split()} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">
          {running ? t('splitByChapterRunning') : t('splitByChapterAction')}
        </button>
      </div>
      <div className="space-y-2">
        {info.chapters.map((chapter, index) => <article key={`${chapter.start}-${index}`} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-800 text-sm text-zinc-400">{index + 1}</span>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{chapter.title}</p><p className="text-xs text-zinc-500">{timestamp(chapter.start)} – {timestamp(chapter.end)}</p></div>
          <button type="button"
                  aria-label={t(playingChapter === index ? 'splitByChapterPause' : 'splitByChapterPlay', {name: chapter.title})}
                  title={t(playingChapter === index ? 'splitByChapterPause' : 'splitByChapterPlay', {name: chapter.title})}
                  disabled={running || loading || loadingChapter === index}
                  onClick={() => void toggleChapterPreview({...chapter, index})}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-violet-300 transition hover:bg-violet-950/60 hover:text-violet-200 disabled:opacity-40">
            <FontAwesomeIcon icon={playingChapter === index ? faPause : faPlay} className="text-xs"/>
          </button>
        </article>)}
      </div>
      {previewError && <p role="alert" className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{previewError}</p>}
      <audio ref={audioRef} preload="metadata" className="hidden"
             onTimeUpdate={() => {
               const range = previewRange.current;
               const audio = audioRef.current;
               if (range && audio && audio.currentTime >= range.end) {
                 audio.pause();
                 previewRange.current = null;
                 setPlayingChapter(null);
               }
             }}
             onEnded={() => {
               previewRange.current = null;
               setPlayingChapter(null);
             }}
             onPause={() => setPlayingChapter(null)}/>
    </section>}
  </>;
}
