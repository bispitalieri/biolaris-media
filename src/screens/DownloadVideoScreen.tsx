import {useCallback, useEffect, useRef, useState} from 'react';
import {open} from '@tauri-apps/plugin-dialog';
import {useTranslation} from 'react-i18next';
import {enqueueVideoDownload, openOutputDirectory, subscribeToProgress, type JobUpdate} from '../lib/media';

export function DownloadVideoScreen() {
  const {t} = useTranslation();
  const [links, setLinks] = useState('');
  const [outputDirectory, setOutputDirectory] = useState<string | null>(null);
  const [status, setStatus] = useState<'ready' | 'running' | 'completed' | 'failed'>('ready');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [completedDirectory, setCompletedDirectory] = useState<string | null>(null);
  const jobId = useRef<string | null>(null);
  const pending = useRef<Record<string, JobUpdate>>({});
  const urls = links.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
  const running = status === 'running';

  const applyUpdate = useCallback((update: JobUpdate) => {
    setStatus(update.status);
    setProgress(update.progress);
    setError(update.error ?? null);
    if (update.outputPath) setCompletedDirectory(update.outputPath);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    subscribeToProgress((update) => {
      if (update.id !== jobId.current) { pending.current[update.id] = update; return; }
      applyUpdate(update);
    }).then((fn) => { if (active) unlisten = fn; else fn(); }).catch(console.error);
    return () => { active = false; unlisten?.(); };
  }, [applyUpdate]);

  const chooseDirectory = async () => {
    const selected = await open({directory: true, multiple: false, title: t('downloadVideoChooseFolder')});
    if (typeof selected === 'string') setOutputDirectory(selected);
  };

  const start = async () => {
    if (!urls.length || running) return;
    setStatus('running'); setProgress(0); setError(null); setOpenError(null); setCompletedDirectory(null); jobId.current = null;
    try {
      const id = await enqueueVideoDownload({urls, outputDirectory});
      jobId.current = id;
      if (pending.current[id]) { const early = pending.current[id]; delete pending.current[id]; applyUpdate(early); }
    } catch (reason) { setStatus('failed'); setError(String(reason)); }
  };

  return <>
    <header className="mb-8"><h1 className="text-xl font-bold tracking-tight">{t('downloadVideoTitle')}</h1><p className="text-sm text-zinc-500">{t('downloadVideoDescription')}</p></header>
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5">
      <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="video-links">{t('downloadVideoLinks')}</label>
      <textarea id="video-links" value={links} disabled={running} onChange={(event) => { setLinks(event.target.value); setStatus('ready'); setError(null); }} placeholder={t('downloadVideoPlaceholder')} rows={7} spellCheck={false} className="mt-2 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 font-mono text-sm text-zinc-100 placeholder:font-sans placeholder:text-zinc-500 disabled:opacity-50" />
      <p className="mt-2 text-xs text-zinc-500">{t('downloadVideoLinkCount', {count: urls.length})}</p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" disabled={running} onClick={() => void chooseDirectory()} className="max-w-full truncate rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">{outputDirectory || t('downloadVideoDefaultFolder')}</button>
        {outputDirectory && <button type="button" disabled={running} onClick={() => setOutputDirectory(null)} className="rounded-lg px-2 py-2 text-sm text-zinc-400 hover:text-white disabled:opacity-50">{t('downloadVideoUseDefault')}</button>}
        <button type="button" disabled={!urls.length || running} onClick={() => void start()} className="ml-auto rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">{running ? t('downloadVideoRunning') : t('downloadVideoAction', {count: urls.length})}</button>
      </div>
    </section>
    {(running || status === 'completed') && <section className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4" aria-live="polite">
      <div className="flex justify-between text-sm"><span>{running ? t('statusRunning') : t('statusCompleted')}</span><span className="text-zinc-400">{progress}%</span></div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-violet-500 transition-all" style={{width: `${progress}%`}}/></div>
      {completedDirectory && <button type="button" onClick={() => { setOpenError(null); void openOutputDirectory(completedDirectory).catch((reason) => setOpenError(String(reason))); }} className="mt-3 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">{t('downloadVideoOpenFolder')}</button>}
    </section>}
    {openError && <p role="alert" className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{openError}</p>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}
  </>;
}
