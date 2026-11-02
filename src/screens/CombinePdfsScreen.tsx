import {useCallback, useEffect, useRef, useState, type MouseEvent} from 'react';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faFilePdf, faGripVertical, faLock, faTrash, faTriangleExclamation} from '@fortawesome/free-solid-svg-icons';
import {useTranslation} from 'react-i18next';
import {DropZone} from '../components/DropZone';
import {
  enqueueCombinePdfs,
  openOutputDirectory,
  openOutputFile,
  probePdfFile,
  showInFinder,
  subscribeToProgress,
  type JobUpdate,
  type PdfFileInfo,
} from '../lib/media';

type PdfStatus = 'checking' | 'ready' | 'locked' | 'invalid';
type PdfFile = {
  path: string;
  name: string;
  status: PdfStatus;
  info?: PdfFileInfo;
  error?: string;
};
type JobStatus = 'ready' | 'running' | 'completed' | 'failed';
type ContextMenu = {x: number; y: number; path: string};

const pdfExtensions = ['pdf'];
const basename = (path: string) => path.split(/[\\/]/).pop() || path;
const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString(undefined, {maximumFractionDigits: 1})} ${units[unit]}`;
};

export function CombinePdfsScreen() {
  const {t} = useTranslation();
  const [files, setFiles] = useState<PdfFile[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [status, setStatus] = useState<JobStatus>('ready');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const jobId = useRef<string | null>(null);
  const pending = useRef<Record<string, JobUpdate>>({});
  const draggedIndex = useRef<number | null>(null);
  const selectedRef = useRef(selectedPaths);
  selectedRef.current = selectedPaths;
  const running = status === 'running';
  const lockedFiles = files.filter((file) => file.status === 'locked');
  const invalidFiles = files.filter((file) => file.status === 'invalid');
  const canCombine = files.length >= 2 && files.every((file) => file.status === 'ready') && !running;

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

  const addPdfs = useCallback((paths: string[]) => {
    const existing = new Set(files.map(({path}) => path));
    const additions = paths.flatMap((path) => {
      if (existing.has(path)) return [];
      existing.add(path);
      return [{path, name: basename(path), status: 'checking' as const}];
    });
    if (!additions.length) return;
    setFiles((current) => [...current, ...additions.filter(({path}) => !current.some((file) => file.path === path))]);
    changed();
    for (const {path} of additions) {
      void probePdfFile(path).then((info) => {
        setFiles((current) => current.map((file) => file.path === path
          ? {...file, info, status: info.locked ? 'locked' : 'ready', error: undefined}
          : file));
      }).catch((reason: unknown) => {
        setFiles((current) => current.map((file) => file.path === path
          ? {...file, status: 'invalid', error: String(reason)}
          : file));
      });
    }
  }, [files]);

  const removePaths = (paths: string[]) => {
    setFiles((current) => current.filter((file) => !paths.includes(file.path)));
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

  const moveFile = (from: number, to: number) => {
    if (from === to || to < 0 || to >= files.length) return;
    setFiles((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    changed();
  };

  const combine = async () => {
    if (!canCombine) return;
    setStatus('running');
    setProgress(0);
    setError(null);
    setOutputPath(null);
    jobId.current = null;
    try {
      const id = await enqueueCombinePdfs(files.map(({path}) => path));
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
      <h1 className="text-xl font-bold tracking-tight">{t('combinePdfsTitle')}</h1>
      <p className="text-sm text-zinc-500">{t('combinePdfsDescription')}</p>
    </header>
    <DropZone
      onFiles={addPdfs}
      allowedExtensions={pdfExtensions}
      multiple
      title={t('combinePdfsDropTitle')}
      description={t('combinePdfsDropDescription')}
    />

    {(running || status === 'completed') && <section className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4" aria-live="polite">
      <div className="flex justify-between text-sm">
        <span>{running ? t('combinePdfsRunning') : t('statusCompleted')}</span>
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
          <h2 className="text-lg font-semibold">{t('combinePdfsList')}</h2>
          <p className="text-sm text-zinc-400">{t('combinePdfsCount', {count: files.length})}</p>
          <p className="text-xs text-zinc-500">{t('combinePdfsListHint')}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={!files.length || running} onClick={() => {
            setFiles([]);
            setSelectedPaths([]);
            changed();
          }} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 disabled:opacity-40">{t('clear')}</button>
          <button type="button" disabled={!canCombine} onClick={() => void combine()}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">
            {running ? t('combinePdfsRunning') : t('combinePdfsAction')}
          </button>
        </div>
      </div>
      {lockedFiles.length > 0 && <p role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-orange-700/50 bg-orange-950/30 px-4 py-3 text-sm text-orange-300">
        <FontAwesomeIcon icon={faLock} className="mt-0.5 shrink-0"/>
        {t('combinePdfsLockedFiles', {count: lockedFiles.length})}
      </p>}
      {invalidFiles.length > 0 && <p role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-orange-700/50 bg-orange-950/30 px-4 py-3 text-sm text-orange-300">
        <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5 shrink-0"/>
        {t('combinePdfsInvalidFiles', {count: invalidFiles.length})}
      </p>}
      {files.length === 0 ? <div className="rounded-xl border border-zinc-800 p-8 text-center text-sm text-zinc-500">{t('combinePdfsEmpty')}</div> :
        <div className="space-y-2" onContextMenu={(event) => event.preventDefault()}>
          {files.map((file, index) => <article key={file.path} draggable={!running}
            onDragStart={() => { draggedIndex.current = index; }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (draggedIndex.current !== null) moveFile(draggedIndex.current, index);
              draggedIndex.current = null;
            }}
            onDragEnd={() => { draggedIndex.current = null; }}
            onContextMenu={(event) => openMenu(event, file.path)}
            className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${selectedPaths.includes(file.path) ? 'border-violet-600/70 bg-violet-950/20' : 'border-zinc-800 bg-zinc-900/60'}`}>
            <input type="checkbox" aria-label={t('combinePdfsSelect', {name: file.name})} checked={selectedPaths.includes(file.path)}
                   disabled={running} onChange={() => setSelectedPaths((current) => current.includes(file.path)
                     ? current.filter((path) => path !== file.path)
                     : [...current, file.path])} className="accent-violet-500"/>
            <FontAwesomeIcon icon={faGripVertical} className="cursor-grab text-zinc-600"/>
            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${file.status === 'locked' ? 'bg-orange-950/50 text-orange-300' : 'bg-zinc-800 text-zinc-400'}`}>
              <FontAwesomeIcon icon={file.status === 'locked' ? faLock : faFilePdf}/>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="truncate text-xs text-zinc-500">{file.path}</p>
              {file.status === 'checking' && <p className="mt-1 text-xs text-zinc-400">{t('combinePdfsChecking')}</p>}
              {file.info && <p className="mt-1 text-xs text-zinc-400">
                {file.info.pageCount === null
                  ? t('combinePdfsFileSizeOnly', {size: formatSize(file.info.sizeBytes)})
                  : t('combinePdfsFileInfo', {pages: file.info.pageCount, size: formatSize(file.info.sizeBytes)})}
              </p>}
              {file.status === 'locked' && <p className="mt-1 text-xs text-orange-300">{t('combinePdfsUnlock')}</p>}
              {file.status === 'invalid' && <p className="mt-1 text-xs text-orange-300">{t('combinePdfsUnreadable', {error: file.error})}</p>}
            </div>
            {file.status === 'locked' && <span className="shrink-0 rounded-full border border-orange-700/60 px-2 py-1 text-xs text-orange-300">{t('combinePdfsLockedBadge')}</span>}
            <span className="shrink-0 text-xs text-zinc-500">{index + 1}</span>
            <button type="button" aria-label={t('removeFile', {name: file.name})} onClick={() => removePaths([file.path])}
                    disabled={running} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-red-950/60 hover:text-red-300 disabled:opacity-30">
              <FontAwesomeIcon icon={faTrash} className="text-xs"/>
            </button>
          </article>)}
        </div>}
      {selectedPaths.length > 0 && <p className="mt-2 text-xs text-zinc-500">{t('combinePdfsSelectedCount', {count: selectedPaths.length})}</p>}
    </section>

    {contextMenu && <div role="menu" style={{left: contextMenu.x, top: contextMenu.y}} onClick={(event) => event.stopPropagation()}
      className="fixed z-50 min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl">
      <button type="button" role="menuitem" disabled={running} onClick={() => removePaths(selectedPaths.includes(contextMenu.path) ? selectedPaths : [contextMenu.path])}
              className="block w-full rounded px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-40">
        {t('combinePdfsRemove')}
      </button>
      <button type="button" role="menuitem" onClick={() => {
        const path = contextMenu.path;
        setContextMenu(null);
        void showInFinder(path).catch((reason) => setOpenError(String(reason)));
      }} className="block w-full rounded px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800">
        {t('combinePdfsShowInFinder')}
      </button>
    </div>}
  </>;
}
