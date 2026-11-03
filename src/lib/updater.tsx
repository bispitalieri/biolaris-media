import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {check, type DownloadEvent, type Update} from '@tauri-apps/plugin-updater';
import {relaunch} from '@tauri-apps/plugin-process';
import {open} from '@tauri-apps/plugin-shell';
import ReactMarkdown from 'react-markdown';
import {useTranslation} from 'react-i18next';
import {useAppSettings} from './settings';

const UPDATE_STATE_KEY = 'biolaris-updater-state';
const RELEASES_URL = 'https://github.com/bispitalieri/biolaris-media/releases/latest';
const CHECK_INTERVALS = { '5m': 5 * 60_000, daily: 24 * 60 * 60_000, weekly: 7 * 24 * 60 * 60_000 } as const;

type PersistedUpdateState = {
  skippedVersion?: string;
  remindAt?: number;
};
type UpdateStage = 'idle' | 'checking' | 'downloading' | 'ready' | 'installed' | 'error';
type UpdateContextValue = {
  update: Update | null;
  stage: UpdateStage;
  progress: number;
  downloadedBytes: number;
  totalBytes: number | null;
  downloadSpeed: number;
  error: string;
  result: 'up-to-date' | null;
  modalVisible: boolean;
  checkForUpdates: (manual?: boolean) => Promise<void>;
  startDownload: () => Promise<void>;
  installUpdate: (relaunchNow: boolean) => Promise<void>;
  remindLater: () => void;
  skipVersion: () => void;
  showUpdate: () => void;
  hideUpdateDialog: () => void;
};

const UpdateContext = createContext<UpdateContextValue | null>(null);

function readSavedState(): PersistedUpdateState {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(UPDATE_STATE_KEY) ?? '{}');
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return {};
    const state = saved as Record<string, unknown>;
    return {
      ...(typeof state.skippedVersion === 'string' ? {skippedVersion: state.skippedVersion} : {}),
      ...(typeof state.remindAt === 'number' && Number.isFinite(state.remindAt) ? {remindAt: state.remindAt} : {}),
    };
  } catch {
    return {};
  }
}

function saveState(state: PersistedUpdateState) {
  try {
    window.localStorage.setItem(UPDATE_STATE_KEY, JSON.stringify(state));
  } catch {
    // Update controls remain available for the current session when storage is unavailable.
  }
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function UpdaterProvider({children}: Readonly<{children: ReactNode}>) {
  const {settings} = useAppSettings();
  const [update, setUpdate] = useState<Update | null>(null);
  const [stage, setStage] = useState<UpdateStage>('idle');
  const [progress, setProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState<number | null>(null);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<'up-to-date' | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const remindTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProgress = useRef({bytes: 0, at: 0});
  const totalBytesRef = useRef<number | null>(null);

  const checkForUpdates = useCallback(async (manual = false) => {
    if (!isTauri()) {
      if (manual) {
        setError('Updates are available in the desktop app only.');
        setStage('error');
      }
      return;
    }

    if (manual) {
      setStage('checking');
      setError('');
      setResult(null);
    }
    try {
      const found = await check({timeout: 20_000});
      if (!found) {
        if (manual) {
          setStage('idle');
          setResult('up-to-date');
        }
        return;
      }

      const saved = readSavedState();
      if (saved.skippedVersion === found.version) {
        await found.close();
        return;
      }

      setUpdate(found);
      setStage('idle');
      setResult(null);
      setError('');
      if (remindTimer.current) clearTimeout(remindTimer.current);
      if (saved.remindAt && saved.remindAt > Date.now()) {
        setModalVisible(false);
        remindTimer.current = setTimeout(() => {
          remindTimer.current = null;
          setModalVisible(true);
        }, saved.remindAt - Date.now());
      } else {
        remindTimer.current = null;
        setModalVisible(true);
      }
    } catch (checkError) {
      if (manual) {
        setError(errorText(checkError));
        setStage('error');
      }
    }
  }, []);

  useEffect(() => {
    if (!isTauri() || !settings.general.automaticUpdates) return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const startChecks = async () => {
      try {
        if (getCurrentWindow().label !== 'main') return;
      } catch {
        return;
      }
      if (!active) return;
      await checkForUpdates();
      if (active) {
        timer = setInterval(() => void checkForUpdates(), CHECK_INTERVALS[settings.general.updateCheckInterval]);
      }
    };

    void startChecks();
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [checkForUpdates, settings.general.automaticUpdates, settings.general.updateCheckInterval]);

  useEffect(() => () => {
    if (remindTimer.current) clearTimeout(remindTimer.current);
    if (update) void update.close();
  }, [update]);

  const startDownload = useCallback(async () => {
    if (!update) return;
    setStage('downloading');
    setError('');
    setProgress(0);
    setDownloadedBytes(0);
    setDownloadSpeed(0);
    setTotalBytes(null);
    totalBytesRef.current = null;
    lastProgress.current = {bytes: 0, at: Date.now()};
    try {
      await update.download((event: DownloadEvent) => {
        if (event.event === 'Started') {
          totalBytesRef.current = event.data.contentLength ?? null;
          setTotalBytes(totalBytesRef.current);
          return;
        }
        if (event.event !== 'Progress') return;
        setDownloadedBytes((current) => {
          const next = current + event.data.chunkLength;
          const now = Date.now();
          const elapsed = now - lastProgress.current.at;
          if (elapsed >= 500) {
            setDownloadSpeed(((next - lastProgress.current.bytes) * 1000) / elapsed);
            lastProgress.current = {bytes: next, at: now};
          }
          setProgress(totalBytesRef.current ? Math.min(100, (next / totalBytesRef.current) * 100) : 0);
          return next;
        });
      });
      setProgress(100);
      setStage('ready');
    } catch (downloadError) {
      setError(errorText(downloadError));
      setStage('error');
    }
  }, [update]);

  const installUpdate = useCallback(async (relaunchNow: boolean) => {
    if (!update) return;
    setError('');
    try {
      if (stage === 'installed') {
        if (relaunchNow) await relaunch();
        return;
      }
      await update.install({restartAfterInstall: relaunchNow});
      if (relaunchNow) await relaunch();
      setStage(relaunchNow ? 'idle' : 'installed');
      setModalVisible(false);
    } catch (installError) {
      setError(errorText(installError));
      setStage('error');
    }
  }, [stage, update]);

  const remindLater = useCallback(() => {
    const remindAt = Date.now() + 24 * 60 * 60_000;
    saveState({...readSavedState(), remindAt});
    setModalVisible(false);
    if (remindTimer.current) clearTimeout(remindTimer.current);
    remindTimer.current = setTimeout(() => {
      remindTimer.current = null;
      setModalVisible(true);
    }, remindAt - Date.now());
  }, []);

  const skipVersion = useCallback(() => {
    if (update) {
      saveState({...readSavedState(), skippedVersion: update.version, remindAt: undefined});
    }
    if (remindTimer.current) clearTimeout(remindTimer.current);
    remindTimer.current = null;
    setUpdate(null);
    setStage('idle');
    setModalVisible(false);
  }, [update]);

  const showUpdate = useCallback(() => {
    if (update) setModalVisible(true);
  }, [update]);
  const hideUpdateDialog = useCallback(() => setModalVisible(false), []);

  const value = useMemo<UpdateContextValue>(() => ({
    update,
    stage,
    progress,
    downloadedBytes,
    totalBytes,
    downloadSpeed,
    error,
    result,
    modalVisible,
    checkForUpdates,
    startDownload,
    installUpdate,
    remindLater,
    skipVersion,
    showUpdate,
    hideUpdateDialog,
  }), [update, stage, progress, downloadedBytes, totalBytes, downloadSpeed, error, result, modalVisible, checkForUpdates, startDownload, installUpdate, remindLater, skipVersion, showUpdate, hideUpdateDialog]);

  return (
    <UpdateContext.Provider value={value}>
      {children}
      {update && modalVisible && <UpdateDialog />}
    </UpdateContext.Provider>
  );
}

export function useUpdater() {
  const context = useContext(UpdateContext);
  if (!context) throw new Error('useUpdater must be used inside UpdaterProvider');
  return context;
}

function formatBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UpdateDialog() {
  const {t} = useTranslation();
  const [linkError, setLinkError] = useState('');
  const {
    update, stage, progress, downloadedBytes, totalBytes, downloadSpeed, error,
    startDownload, installUpdate, remindLater, skipVersion, hideUpdateDialog,
  } = useUpdater();
  const openExternal = async (url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') await open(parsed.href);
    } catch (openError) {
      setLinkError(errorText(openError));
    }
  };
  if (!update) return null;

  const notes = update.body?.trim() || t('updateNoReleaseNotes');
  const badgeKey = /security|vulnerab|cve/i.test(notes) ? 'updateBadgeSecurity'
    : /critical|important|breaking/i.test(notes) ? 'updateBadgeImportant'
      : 'updateBadgeFeature';
  const date = update.date ? new Date(update.date).toLocaleDateString() : t('updateDateUnavailable');

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-300">{t('updateAvailable')}</p>
            <h2 id="update-title" className="mt-1 text-xl font-bold">{t('updateVersionChange', {current: update.currentVersion, next: update.version})}</h2>
            <p className="mt-1 text-sm text-zinc-400">{t('updateReleaseDate', {date})}</p>
          </div>
          <span className="shrink-0 rounded-full bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-200">{t(badgeKey)}</span>
        </div>

        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">{t('updateReleaseNotes')}</h3>
          <div className="app-scrollbar max-h-60 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm leading-relaxed text-zinc-300">
            <ReactMarkdown
              components={{
                h1: ({children}) => <h4 className="mb-2 mt-4 text-base font-semibold text-zinc-100">{children}</h4>,
                h2: ({children}) => <h4 className="mb-2 mt-4 text-sm font-semibold text-zinc-100">{children}</h4>,
                h3: ({children}) => <h4 className="mb-2 mt-3 font-semibold text-zinc-100">{children}</h4>,
                ul: ({children}) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
                ol: ({children}) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
                a: ({children, href}) => (
                  <a
                    href={href}
                    onClick={(event) => {
                      event.preventDefault();
                      if (href) void openExternal(href);
                    }}
                    className="text-violet-300 underline"
                  >
                    {children}
                  </a>
                ),
                p: ({children}) => <p className="my-2">{children}</p>,
              }}
            >
              {notes}
            </ReactMarkdown>
          </div>
        </div>

        {stage === 'downloading' && (
          <div className="mt-5" role="status" aria-live="polite">
            <div className="mb-2 flex justify-between gap-3 text-xs text-zinc-300">
              <span>{t('updateDownloading')}</span>
              <span>{totalBytes ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}` : formatBytes(downloadedBytes)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-violet-500 transition-[width]" style={{width: `${progress}%`}} />
            </div>
            <p className="mt-2 text-right text-xs text-zinc-500">{progress.toFixed(0)}% · {t('updateDownloadSpeed', {speed: formatBytes(downloadSpeed) + '/s'})}</p>
          </div>
        )}
        {stage === 'ready' && <p className="mt-4 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{t('updateReady')}</p>}
        {stage === 'installed' && <p className="mt-4 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{t('updateInstalled')}</p>}
        {linkError && <p className="mt-4 text-sm text-red-300" role="alert">{linkError}</p>}
        {error && stage === 'error' && (
          <div className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300" role="alert">
            <p>{t('updateDownloadError', {error})}</p>
            <div className="mt-2 flex gap-4">
              <button type="button" onClick={() => void startDownload()} className="font-semibold underline">{t('updateRetry')}</button>
              <button type="button" onClick={() => void openExternal(RELEASES_URL)} className="underline">{t('updateManualDownload')}</button>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          {stage === 'ready' || stage === 'installed' ? (
            <>
              {stage === 'ready' && <button type="button" onClick={() => void installUpdate(false)} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800">{t('updateNextLaunch')}</button>}
              <button type="button" onClick={() => void installUpdate(true)} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500">{t('updateRelaunchInstall')}</button>
            </>
          ) : stage === 'downloading' ? (
            <button type="button" onClick={hideUpdateDialog} className="text-sm text-zinc-400 hover:text-zinc-200">{t('updateHideDownload')}</button>
          ) : (
            <>
              <button type="button" disabled={stage === 'checking'} onClick={remindLater} className="text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-50">{t('updateRemindLater')}</button>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={skipVersion} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">{t('updateSkipVersion')}</button>
                <button type="button" disabled={stage === 'checking'} onClick={() => void startDownload()} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50">{t('updateNow')}</button>
              </div>
            </>
          )}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-zinc-500">{t('updateRestartWarning')}</p>
      </section>
    </div>
  );
}
