import {useCallback, useEffect, useRef, useState, type MouseEvent} from 'react';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {convertFileSrc} from '@tauri-apps/api/core';
import {faGripVertical, faMusic, faPause, faPlay, faTrash, faTriangleExclamation} from '@fortawesome/free-solid-svg-icons';
import {useTranslation} from 'react-i18next';
import {useAppSettings} from '../lib/settings';
import {DropZone} from '../components/DropZone';
import {
  enqueueMergeAudio,
  openOutputDirectory,
  openOutputFile,
  prepareAudioPreview,
  probeAudioFile,
  showInFinder,
  subscribeToProgress,
  type JobUpdate,
  type MergeAudioFormat,
} from '../lib/media';

type AudioTrack = {
  path: string;
  name: string;
  status: 'checking' | 'ready' | 'invalid';
  error?: string;
};
type JobStatus = 'ready' | 'running' | 'completed' | 'failed';
type ContextMenu = {x: number; y: number; path: string};
type AudioPreview = {path: string; trackPath: string; name: string};
const formats: Exclude<MergeAudioFormat, 'first'>[] = ['mp3', 'm4a', 'm4b', 'aac', 'wav', 'aiff', 'flac', 'ogg', 'opus', 'ac3'];
const basename = (path: string) => path.split(/[\\/]/).pop() || path;
const extension = (path: string) => basename(path).split('.').pop()?.toLowerCase() || '';
const normalizeFormat = (ext: string): Exclude<MergeAudioFormat, 'first'> | null => {
  if (ext === 'oga') return 'ogg';
  if (ext === 'aif') return 'aiff';
  if (ext === 'm4r' || ext === 'alac') return 'm4a';
  if (ext === 'adts') return 'aac';
  return formats.includes(ext as typeof formats[number]) ? ext as typeof formats[number] : null;
};

export function MergeAudioScreen() {
  const {t} = useTranslation();
  const {settings, updateSettings} = useAppSettings();
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [format, setFormat] = useState<MergeAudioFormat>(settings.mergeAudio.format);
  const [addChapterMarkers, setAddChapterMarkers] = useState(settings.mergeAudio.addChapterMarkers);
  const [outputName, setOutputName] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [status, setStatus] = useState<JobStatus>('ready');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [previewTrack, setPreviewTrack] = useState<AudioPreview | null>(null);
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const [previewLoadingPath, setPreviewLoadingPath] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewRequest = useRef(0);
  const jobId = useRef<string | null>(null);
  const pending = useRef<Record<string, JobUpdate>>({});
  const draggedIndex = useRef<number | null>(null);
  const selectedRef = useRef(selectedPaths);
  selectedRef.current = selectedPaths;
  const running = status === 'running';
  const firstFormat = normalizeFormat(extension(tracks[0]?.path ?? '')) ?? 'm4a';
  const outputFormat = format === 'first' ? firstFormat : format;
  const defaultName = tracks[0] ? `${basename(tracks[0].path).replace(/\.[^.]+$/, '')} (merged)` : 'merged-audio';
  const invalidTracks = tracks.filter((track) => track.status === 'invalid');
  const canMerge = tracks.length >= 2 && tracks.every((track) => track.status === 'ready') && !running;

  const stopPreview = () => {
    previewRequest.current++;
    audioRef.current?.pause();
    setPreviewTrack(null);
    setPlayingPath(null);
    setPreviewLoadingPath(null);
    setPreviewError(null);
  };

  const togglePreview = async (track: AudioTrack) => {
    if (track.status !== 'ready' || running) return;
    const audio = audioRef.current;
    if (previewTrack?.trackPath === track.path && audio) {
      if (audio.paused) {
        setPreviewError(null);
        void audio.play().catch((reason: unknown) => {
          setPreviewError(t('mergeAudioPreviewError', {error: String(reason)}));
        });
      } else {
        audio.pause();
      }
      return;
    }

    const request = ++previewRequest.current;
    audio?.pause();
    setPlayingPath(null);
    setPreviewError(null);
    setPreviewLoadingPath(track.path);
    try {
      const path = await prepareAudioPreview(track.path);
      if (request !== previewRequest.current) return;
      setPreviewTrack({path, trackPath: track.path, name: track.name});
    } catch (reason) {
      if (request === previewRequest.current) {
        setPreviewError(t('mergeAudioPreviewError', {error: String(reason)}));
      }
    } finally {
      if (request === previewRequest.current) setPreviewLoadingPath(null);
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !previewTrack) return;
    audio.src = convertFileSrc(previewTrack.path);
    audio.load();
    void audio.play().catch((reason: unknown) => {
      setPreviewError(t('mergeAudioPreviewError', {error: String(reason)}));
    });
  }, [previewTrack, t]);

  useEffect(() => () => {
    previewRequest.current++;
    audioRef.current?.pause();
  }, []);

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
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    }).catch(console.error);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [applyUpdate]);

  useEffect(() => {
    setFormat(settings.mergeAudio.format);
    setAddChapterMarkers(settings.mergeAudio.addChapterMarkers);
  }, [settings.mergeAudio.format, settings.mergeAudio.addChapterMarkers]);

  const setMergeFormat = (next: MergeAudioFormat) => {
    setFormat(next);
    updateSettings((current) => ({...current, mergeAudio: {...current.mergeAudio, format: next}}));
    changed();
  };
  const setChapterMarkers = (next: boolean) => {
    setAddChapterMarkers(next);
    updateSettings((current) => ({...current, mergeAudio: {...current.mergeAudio, addChapterMarkers: next}}));
    changed();
  };

  const addAudio = useCallback((paths: string[]) => {
    const existing = new Set(tracks.map(({path}) => path));
    const additions = paths
      .filter((path) => !existing.has(path))
      .map((path) => ({path, name: basename(path), status: 'checking' as const}));
    if (!additions.length) return;
    setTracks((current) => [...current, ...additions.filter(({path}) => !current.some((track) => track.path === path))]);
    setError(null);
    setOutputPath(null);
    setProgress(0);
    setStatus((current) => current === 'completed' || current === 'failed' ? 'ready' : current);
    for (const {path} of additions) {
      void probeAudioFile(path).then(() => {
        setTracks((current) => current.map((track) => track.path === path
          ? {...track, status: 'ready', error: undefined}
          : track));
      }).catch((reason: unknown) => {
        setTracks((current) => current.map((track) => track.path === path
          ? {...track, status: 'invalid', error: String(reason)}
          : track));
      });
    }
  }, [tracks]);

  const removePaths = (paths: string[]) => {
    if ((previewTrack && paths.includes(previewTrack.trackPath))
      || (previewLoadingPath && paths.includes(previewLoadingPath))) stopPreview();
    setTracks((current) => current.filter((track) => !paths.includes(track.path)));
    setSelectedPaths((current) => current.filter((path) => !paths.includes(path)));
    setContextMenu(null);
    changed();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (running || !['Delete', 'Backspace'].includes(event.key)) return;
      const target = event.target;
      if (target instanceof HTMLElement
        && (target.isContentEditable
          || (target instanceof HTMLInputElement && target.type !== 'checkbox')
          || ['TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (!selectedRef.current.length) return;
      event.preventDefault();
      removePaths(selectedRef.current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [running]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  const moveTrack = (from: number, to: number) => {
    if (from === to || to < 0 || to >= tracks.length) return;
    setTracks((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    changed();
  };

  const merge = async () => {
    if (!canMerge) return;
    stopPreview();
    setStatus('running');
    setProgress(0);
    setError(null);
    setOutputPath(null);
    jobId.current = null;
    try {
      const id = await enqueueMergeAudio({
        audioPaths: tracks.map(({path}) => path),
        outputName: outputName.trim(),
        format: outputFormat,
        addChapterMarkers: addChapterMarkers && outputFormat === 'm4b',
        autoRenameOutputs: settings.general.autoRenameOutputs,
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

  const openMenu = (event: MouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedPaths.includes(path)) setSelectedPaths([path]);
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 100),
      path,
    });
  };

  return <>
    <header className="mb-8">
      <h1 className="text-xl font-bold tracking-tight">{t('mergeAudioTitle')}</h1>
      <p className="text-sm text-zinc-500">{t('mergeAudioDescription')}</p>
    </header>
    <DropZone onFiles={addAudio} audioOnly multiple title={t('audioDropTitle')} description={t('audioDropDescription')}/>
    <p className="mt-3 text-sm text-zinc-400">{t('mergeAudioLosslessNote')}</p>

    <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5">
      <div>
        <h2 className="font-semibold">{t('mergeAudioOptions')}</h2>
        <p className="text-sm text-zinc-400">{t('mergeAudioOutputFormat')}: {outputFormat.toUpperCase()}</p>
      </div>
      <button type="button" aria-expanded={optionsOpen} onClick={() => setOptionsOpen((open) => !open)}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800">
        {t('mergeAudioOptions')}
      </button>
      {optionsOpen && <div className="grid w-full gap-4 border-t border-zinc-800 pt-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm font-medium">
          <span>{t('mergeAudioOutputFormat')}</span>
          <select value={format} disabled={running} onChange={(event) => setMergeFormat(event.target.value as MergeAudioFormat)}
                  className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-zinc-100 disabled:opacity-50">
            <option value="first">{t('mergeAudioSameAsFirst', {format: outputFormat.toUpperCase()})}</option>
            {formats.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          <span>{t('mergeAudioOutputName')}</span>
          <span className="flex">
            <input type="text" value={outputName} maxLength={240} disabled={running} placeholder={defaultName}
                   onChange={(event) => {
                     setOutputName(event.target.value.replace(new RegExp(`\\.${outputFormat}$`, 'i'), ''));
                     changed();
                   }}
                   className="min-w-0 flex-1 rounded-l-lg border border-r-0 border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 disabled:opacity-50"/>
            <span className="inline-flex items-center rounded-r-lg border border-zinc-700 bg-zinc-700/70 px-3 text-sm text-zinc-300">.{outputFormat}</span>
          </span>
        </label>
        {outputFormat === 'm4b' && <label className="flex items-center gap-2 text-sm text-zinc-300 sm:col-span-2">
          <input type="checkbox" checked={addChapterMarkers} disabled={running}
                 onChange={(event) => setChapterMarkers(event.target.checked)} className="accent-violet-500"/>
          {t('mergeAudioChapterMarkers')}
        </label>}
      </div>}
    </section>

    {(running || status === 'completed') && <section className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4" aria-live="polite">
      <div className="flex justify-between text-sm">
        <span>{running ? t('mergeAudioRunning') : t('statusCompleted')}</span>
        <span className="text-zinc-400">{progress}%</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-violet-500 transition-all" style={{width: `${progress}%`}}/>
      </div>
      {outputPath && <>
        <p className="mt-3 break-all text-xs text-zinc-400">{t('slideshowOutput')}: {outputPath}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => { setOpenError(null); void openOutputFile(outputPath).catch((reason) => setOpenError(String(reason))); }}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800">{t('openOutputFile')}</button>
          <button type="button" onClick={() => { setOpenError(null); void openOutputDirectory(outputPath).catch((reason) => setOpenError(String(reason))); }}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800">{t('openOutputDirectory')}</button>
        </div>
      </>}
    </section>}
    {openError && <p role="alert" className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{openError}</p>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}

    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('mergeAudioList')}</h2>
          <p className="text-sm text-zinc-400">{t('mergeAudioCount', {count: tracks.length})}</p>
          <p className="text-xs text-zinc-500">{t('mergeAudioListHint')}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={!tracks.length || running} onClick={() => {
            stopPreview();
            setTracks([]);
            setSelectedPaths([]);
            setOutputName('');
            changed();
          }} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 disabled:opacity-40">{t('clear')}</button>
          <button type="button" disabled={!canMerge} onClick={() => void merge()}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">
            {running ? t('mergeAudioRunning') : t('mergeAudioAction')}
          </button>
        </div>
      </div>
      {invalidTracks.length > 0 && <p role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-orange-700/50 bg-orange-950/30 px-4 py-3 text-sm text-orange-300">
        <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5 shrink-0"/>
        {t('mergeAudioInvalidFiles', {count: invalidTracks.length})}
      </p>}
      {tracks.length === 0 ? <div className="rounded-xl border border-zinc-800 p-8 text-center text-sm text-zinc-500">{t('mergeAudioEmpty')}</div> :
        <div className="space-y-2" onContextMenu={(event) => event.preventDefault()}>
          {tracks.map((track, index) => <article key={track.path} draggable={!running}
            onDragStart={() => { draggedIndex.current = index; }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (draggedIndex.current !== null) moveTrack(draggedIndex.current, index);
              draggedIndex.current = null;
            }}
            onDragEnd={() => { draggedIndex.current = null; }}
            onContextMenu={(event) => openMenu(event, track.path)}
            className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${selectedPaths.includes(track.path) ? 'border-violet-600/70 bg-violet-950/20' : 'border-zinc-800 bg-zinc-900/60'}`}>
            <input type="checkbox" aria-label={t('mergeAudioSelect', {name: track.name})} checked={selectedPaths.includes(track.path)}
                   disabled={running} onChange={() => setSelectedPaths((current) => current.includes(track.path)
                     ? current.filter((path) => path !== track.path)
                     : [...current, track.path])} className="accent-violet-500"/>
            <FontAwesomeIcon icon={faGripVertical} className="cursor-grab text-zinc-600"/>
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-zinc-800 text-zinc-400"><FontAwesomeIcon icon={faMusic}/></div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{track.name}</p>
              <p className="truncate text-xs text-zinc-500">{track.path}</p>
              {track.status === 'checking' && <p className="mt-1 text-xs text-zinc-400">{t('mergeAudioChecking')}</p>}
              {track.status === 'invalid' && <p className="mt-1 text-xs text-orange-300">{t('mergeAudioUnreadable', {error: track.error})}</p>}
            </div>
            <span className="shrink-0 text-xs text-zinc-500">{index + 1}</span>
            <button type="button"
                    aria-label={playingPath === track.path ? t('mergeAudioPause', {name: track.name}) : t('mergeAudioPlay', {name: track.name})}
                    title={playingPath === track.path ? t('mergeAudioPause', {name: track.name}) : t('mergeAudioPlay', {name: track.name})}
                    disabled={track.status !== 'ready' || running || previewLoadingPath === track.path}
                    onClick={() => void togglePreview(track)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-violet-300 hover:bg-violet-950/60 hover:text-violet-200 disabled:opacity-30">
              <FontAwesomeIcon icon={playingPath === track.path ? faPause : faPlay} className="text-xs"/>
            </button>
            <button type="button" aria-label={t('removeFile', {name: track.name})} onClick={() => removePaths([track.path])}
                    disabled={running} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-red-950/60 hover:text-red-300 disabled:opacity-30">
              <FontAwesomeIcon icon={faTrash} className="text-xs"/>
            </button>
          </article>)}
        </div>}
      {previewTrack && <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <p className="mb-2 truncate text-sm font-medium">{t('mergeAudioPreview', {name: previewTrack.name})}</p>
        <audio ref={audioRef} controls preload="metadata" className="w-full"
               onPlay={() => setPlayingPath(previewTrack.trackPath)}
               onPause={() => setPlayingPath(null)}
               onError={() => {
                 setPlayingPath(null);
                 setPreviewError(t('mergeAudioPreviewError', {error: t('mergeAudioUnsupportedPreview')}));
               }}/>
      </div>}
      {previewError && <p role="alert" className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{previewError}</p>}
      {selectedPaths.length > 0 && <p className="mt-2 text-xs text-zinc-500">{t('mergeAudioSelectedCount', {count: selectedPaths.length})}</p>}
    </section>

    {contextMenu && <div role="menu" style={{left: contextMenu.x, top: contextMenu.y}} onClick={(event) => event.stopPropagation()}
      className="fixed z-50 min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl">
      <button type="button" role="menuitem" disabled={running} onClick={() => removePaths(selectedPaths.includes(contextMenu.path) ? selectedPaths : [contextMenu.path])}
              className="block w-full rounded px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-40">
        {t('mergeAudioRemove')}
      </button>
      <button type="button" role="menuitem" onClick={() => {
        const path = contextMenu.path;
        setContextMenu(null);
        void showInFinder(path).catch((reason) => setOpenError(String(reason)));
      }} className="block w-full rounded px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800">
        {t('mergeAudioShowInFinder')}
      </button>
    </div>}
  </>;
}
