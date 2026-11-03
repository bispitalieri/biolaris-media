import {useCallback, useEffect, useRef, useState} from 'react';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faFilePdf, faFolderOpen, faLock, faTrash, faTriangleExclamation} from '@fortawesome/free-solid-svg-icons';
import {useTranslation} from 'react-i18next';
import {DropZone} from '../components/DropZone';
import {
  enqueueSplitPdfs,
  openOutputDirectory,
  probePdfFile,
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
const pdfExtensions = ['pdf'];
const basename = (path: string) => path.split(/[\\/]/).pop() || path;

export function SplitPdfsScreen() {
  const {t} = useTranslation();
  const [files, setFiles] = useState<PdfFile[]>([]);
  const [pageRanges, setPageRanges] = useState('');
  const [status, setStatus] = useState<JobStatus>('ready');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [outputDirectory, setOutputDirectory] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const jobId = useRef<string | null>(null);
  const pending = useRef<Record<string, JobUpdate>>({});
  const running = status === 'running';
  const lockedFiles = files.filter((file) => file.status === 'locked');
  const invalidFiles = files.filter((file) => file.status === 'invalid');
  const ready = files.length > 0 && files.every((file) => file.status === 'ready') && !running;

  const changed = () => {
    setError(null);
    setOutputDirectory(null);
    setProgress(0);
    setStatus((current) => current === 'completed' || current === 'failed' ? 'ready' : current);
  };

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

  const removeFile = (path: string) => {
    setFiles((current) => current.filter((file) => file.path !== path));
    changed();
  };

  const split = async () => {
    if (!ready) return;
    setStatus('running');
    setProgress(0);
    setError(null);
    setOutputDirectory(null);
    jobId.current = null;
    try {
      const id = await enqueueSplitPdfs(files.map(({path}) => path), pageRanges);
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
      <h1 className="text-xl font-bold tracking-tight">{t('splitPdfsTitle')}</h1>
      <p className="text-sm text-zinc-500">{t('splitPdfsDescription')}</p>
    </header>
    <DropZone
      onFiles={addPdfs}
      allowedExtensions={pdfExtensions}
      multiple
      title={t('splitPdfsDropTitle')}
      description={t('splitPdfsDropDescription')}
    />

    <section className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <label htmlFor="pdf-page-ranges" className="block text-sm font-medium">{t('splitPdfsRangesLabel')}</label>
      <input id="pdf-page-ranges" type="text" value={pageRanges} disabled={running}
        onChange={(event) => {
          setPageRanges(event.target.value);
          changed();
        }}
        placeholder={t('splitPdfsRangesPlaceholder')}
        className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 disabled:opacity-50"/>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">{t('splitPdfsRangesHint')}</p>
    </section>

    {(running || status === 'completed') && <section className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4" aria-live="polite">
      <div className="flex justify-between text-sm">
        <span>{running ? t('splitPdfsRunning') : t('statusCompleted')}</span>
        <span className="text-zinc-400">{progress}%</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-violet-500 transition-all" style={{width: `${progress}%`}}/>
      </div>
      {outputDirectory && <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="break-all text-xs text-zinc-400">{t('splitPdfsOutput')}: {outputDirectory}</p>
        <button type="button" onClick={() => {
          setOpenError(null);
          void openOutputDirectory(outputDirectory).catch((reason) => setOpenError(String(reason)));
        }} className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800">
          <FontAwesomeIcon icon={faFolderOpen}/>{t('openOutputDirectory')}
        </button>
      </div>}
    </section>}
    {openError && <p role="alert" className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{openError}</p>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}

    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('splitPdfsList')}</h2>
          <p className="text-sm text-zinc-400">{t('splitPdfsCount', {count: files.length})}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={!files.length || running} onClick={() => {
            setFiles([]);
            changed();
          }} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 disabled:opacity-40">{t('clear')}</button>
          <button type="button" disabled={!ready} onClick={() => void split()}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">
            {running ? t('splitPdfsRunning') : t('splitPdfsAction')}
          </button>
        </div>
      </div>
      {lockedFiles.length > 0 && <p role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-orange-700/50 bg-orange-950/30 px-4 py-3 text-sm text-orange-300">
        <FontAwesomeIcon icon={faLock} className="mt-0.5 shrink-0"/>
        {t('splitPdfsLockedFiles', {count: lockedFiles.length})}
      </p>}
      {invalidFiles.length > 0 && <p role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-orange-700/50 bg-orange-950/30 px-4 py-3 text-sm text-orange-300">
        <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5 shrink-0"/>
        {t('splitPdfsInvalidFiles', {count: invalidFiles.length})}
      </p>}
      {files.length === 0 ? <div className="rounded-xl border border-zinc-800 p-8 text-center text-sm text-zinc-500">{t('splitPdfsEmpty')}</div> :
        <div className="space-y-2">
          {files.map((file) => <article key={file.path} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-3">
            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${file.status === 'locked' ? 'bg-orange-950/50 text-orange-300' : 'bg-zinc-800 text-zinc-400'}`}>
              <FontAwesomeIcon icon={file.status === 'locked' ? faLock : faFilePdf}/>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="truncate text-xs text-zinc-500">{file.path}</p>
              {file.status === 'checking' && <p className="mt-1 text-xs text-zinc-400">{t('splitPdfsChecking')}</p>}
              {file.info?.pageCount != null && <p className="mt-1 text-xs text-zinc-400">{t('splitPdfsPageCount', {count: file.info.pageCount})}</p>}
              {file.status === 'locked' && <p className="mt-1 text-xs text-orange-300">{t('splitPdfsUnlock')}</p>}
              {file.status === 'invalid' && <p className="mt-1 text-xs text-orange-300">{t('splitPdfsUnreadable', {error: file.error})}</p>}
            </div>
            {file.status === 'locked' && <span className="shrink-0 rounded-full border border-orange-700/60 px-2 py-1 text-xs text-orange-300">{t('combinePdfsLockedBadge')}</span>}
            <button type="button" aria-label={t('removeFile', {name: file.name})} onClick={() => removeFile(file.path)}
              disabled={running} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-red-950/60 hover:text-red-300 disabled:opacity-30">
              <FontAwesomeIcon icon={faTrash} className="text-xs"/>
            </button>
          </article>)}
        </div>}
    </section>
  </>;
}
