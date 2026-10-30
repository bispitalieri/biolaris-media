import {useCallback, useEffect, useRef, useState} from 'react';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faArrowDown, faArrowUp, faFilm, faTrash} from '@fortawesome/free-solid-svg-icons';
import {useTranslation} from 'react-i18next';
import {useAppSettings} from '../lib/settings';
import {DropZone} from '../components/DropZone';
import {enqueueCombineVideos, openOutputDirectory, openOutputFile, type JobUpdate, subscribeToProgress} from '../lib/media';

type Video = { path: string; name: string };
type Format = 'first' | 'mp4' | 'webm' | 'mkv' | 'avi' | 'mov';
type Status = 'ready' | 'running' | 'completed' | 'failed';
const formats = ['mp4', 'webm', 'mkv', 'avi', 'mov'] as const;
const basename = (path: string) => path.split(/[\\/]/).pop() || path;
const extension = (path: string) => basename(path).split('.').pop()?.toLowerCase() || '';

export function CombineVideosScreen() {
  const {t} = useTranslation();
  const {settings} = useAppSettings();
  const [videos, setVideos] = useState<Video[]>([]);
  const [format, setFormat] = useState<Format>('first');
  const [outputName, setOutputName] = useState('');
  const [status, setStatus] = useState<Status>('ready');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const jobId = useRef<string | null>(null);
  const pending = useRef<Record<string, JobUpdate>>({});
  const running = status === 'running';
  const firstExt = extension(videos[0]?.path ?? '');
  const outputFormat = format === 'first' ? (formats.includes(firstExt as typeof formats[number]) ? firstExt as typeof formats[number] : 'mp4') : format;
  const defaultName = videos[0] ? `${basename(videos[0].path).replace(/\.[^.]+$/, '')}-combined` : 'combined-video';

  const changed = () => {
    setError(null);
    setOutputPath(null);
    setProgress(0);
    setStatus((current) => current === 'completed' || current === 'failed' ? 'ready' : current);
  };

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
        pending.current[update.id] = update;
        return;
      }
      applyUpdate(update);
    })
      .then((fn) => {
        if (active) unlisten = fn; else fn();
      }).catch(console.error);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [applyUpdate]);

  const addVideos = useCallback((paths: string[]) => {
    setVideos((current) => {
      const existing = new Set(current.map(({path}) => path));
      return [...current, ...paths.filter((path) => !existing.has(path)).map((path) => ({path, name: basename(path)}))];
    });
    setError(null);
    setOutputPath(null);
    setProgress(0);
    setStatus((current) => current === 'completed' || current === 'failed' ? 'ready' : current);
  }, []);

  const move = (index: number, direction: -1 | 1) => {
    setVideos((current) => {
      const next = [...current];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
    changed();
  };

  const combine = async () => {
    if (videos.length < 2 || running) return;
    setStatus('running');
    setProgress(0);
    setError(null);
    setOutputPath(null);
    jobId.current = null;
    try {
      const id = await enqueueCombineVideos({
        videoPaths: videos.map(({path}) => path),
        outputName: outputName.trim(),
        format: outputFormat,
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
    <header className="mb-8"><h1 className="text-xl font-bold tracking-tight">{t('combineVideosTitle')}</h1><p
      className="text-sm text-zinc-500">{t('combineVideosDescription')}</p></header>
    <DropZone onFiles={addVideos} videoOnly multiple/>
    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm font-medium"><span>{t('combineVideosFormat')}</span><select
          value={format} disabled={running} onChange={(event) => {
          setFormat(event.target.value as Format);
          changed();
        }} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-zinc-100 disabled:opacity-50">
          <option value="first">{t('combineVideosSameAsFirst', {format: outputFormat.toUpperCase()})}</option>
          {formats.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
        <label className="flex flex-col gap-2 text-sm font-medium"><span>{t('combineVideosOutputName')}</span><span
          className="flex"><input type="text" value={outputName} maxLength={240} disabled={running} placeholder={defaultName} onChange={(event) => {
          setOutputName(event.target.value.replace(new RegExp(`\\.${outputFormat}$`, 'i'), ''));
          changed();
        }} className="min-w-0 flex-1 rounded-l-lg border border-r-0 border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 disabled:opacity-50"/><span
          className="inline-flex items-center rounded-r-lg border border-zinc-700 bg-zinc-700/70 px-3 text-sm text-zinc-300">.{outputFormat}</span></span></label>
      </div>
    </section>
    {(running || status === 'completed') &&
      <section className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4" aria-live="polite">
        <div className="flex justify-between text-sm"><span>{running ? t('statusRunning') : t('statusCompleted')}</span><span
          className="text-zinc-400">{progress}%</span></div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full rounded-full bg-violet-500 transition-all" style={{width: `${progress}%`}}/>
        </div>
        {outputPath && <>
          <p className="mt-3 break-all text-xs text-zinc-400">{t('slideshowOutput')}: {outputPath}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => { setOpenError(null); void openOutputFile(outputPath).catch((reason) => setOpenError(String(reason))); }} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800">{t('openOutputFile')}</button>
            <button type="button" onClick={() => { setOpenError(null); void openOutputDirectory(outputPath).catch((reason) => setOpenError(String(reason))); }} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800">{t('openOutputDirectory')}</button>
          </div>
        </>}
      </section>}
    {openError && <p role="alert" className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{openError}</p>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}
    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold">{t('combineVideosList')}</h2><p
          className="text-sm text-zinc-400">{t('combineVideosCount', {count: videos.length})}</p></div>
        <div className="flex gap-2">
          <button type="button" disabled={!videos.length || running} onClick={() => {
            setVideos([]);
            setOutputName('');
            changed();
          }} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 disabled:opacity-40">{t('clear')}</button>
          <button type="button" disabled={videos.length < 2 || running} onClick={() => void combine()} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">{running ? t('combineVideosRunning') : t('combineVideosAction')}</button>
        </div>
      </div>
      {videos.length === 0 ? <div className="rounded-xl border border-zinc-800 p-8 text-center text-sm text-zinc-500">{t('combineVideosEmpty')}</div> :
        <div className="space-y-2">{videos.map((video, index) => <article key={video.path} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-zinc-800 text-zinc-400">
            <FontAwesomeIcon icon={faFilm}/></div>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{video.name}</p><p
            className="truncate text-xs text-zinc-500">{video.path}</p></div>
          <span className="hidden text-xs text-zinc-500 sm:inline">{index + 1}</span>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" aria-label={t('combineVideosMoveUp', {name: video.name})}
                    onClick={() => move(index, -1)} disabled={index === 0 || running}
                    className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-30">
              <FontAwesomeIcon icon={faArrowUp} className="text-xs"/></button>
            <button type="button" aria-label={t('combineVideosMoveDown', {name: video.name})}
                    onClick={() => move(index, 1)} disabled={index === videos.length - 1 || running}
                    className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-30">
              <FontAwesomeIcon icon={faArrowDown} className="text-xs"/></button>
            <button type="button" aria-label={t('removeFile', {name: video.name})} onClick={() => {
              setVideos((current) => current.filter((item) => item.path !== video.path));
              changed();
            }} disabled={running}
                    className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 hover:bg-red-950/60 hover:text-red-300 disabled:opacity-30">
              <FontAwesomeIcon icon={faTrash} className="text-xs"/></button>
          </div>
        </article>)}</div>}
    </section>
  </>;
}
