import {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {
  faBezierCurve,
  faFolderOpen,
  faFileCode,
  faPlay,
} from '@fortawesome/free-solid-svg-icons';
import {DropZone} from '../components/DropZone';
import {
  enqueueVectorize,
  getParallelism,
  openOutputFile,
  showInFinder,
  subscribeToProgress,
  type JobUpdate,
  type VectorizeStyle
} from '../lib/media';

export type VectorizeItem = {
  path: string;
  name: string;
  ext: string;
  style: VectorizeStyle;
  status: 'ready' | 'running' | 'completed' | 'failed';
  progress: number;
  outputPath?: string;
  error?: string;
};

const SUPPORTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'tif', 'webp'];
const SUPPORTED_SET = new Set(SUPPORTED_EXTENSIONS);

function getExtension(path: string): string {
  return path.match(/\.([^./\\]+)$/)?.[1]?.toLowerCase() || '';
}

function getBasename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function getDirectory(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join('/') || path;
}

function outputForVectorize(inputPath: string): string {
  const clean = inputPath.replace(/\.[^./\\]*$/, '');
  return `${clean}.svg`;
}

export function VectorizeScreen() {
  const {t} = useTranslation();
  const [items, setItems] = useState<VectorizeItem[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [bottomBarStyle, setBottomBarStyle] = useState<VectorizeStyle>('logo');
  const [parallelism, setParallelism] = useState<number>(1);
  const [actionError, setActionError] = useState<string | null>(null);

  const jobPathsRef = useRef<Record<string, string>>({});
  const pendingUpdates = useRef<Record<string, JobUpdate>>({});

  useEffect(() => {
    getParallelism().then(setParallelism).catch(() => {});

    let unlisten: (() => void) | undefined;
    let active = true;

    subscribeToProgress((update: JobUpdate) => {
      const path = jobPathsRef.current[update.id];
      if (!path) {
        pendingUpdates.current[update.id] = update;
        return;
      }

      setItems((prev) =>
        prev.map((item) =>
          item.path === path
            ? {
                ...item,
                status: update.status,
                progress: update.progress,
                outputPath: update.outputPath ?? item.outputPath,
                error: update.error ?? undefined,
              }
            : item
        )
      );
    })
      .then((fn) => {
        if (active) unlisten = fn;
        else fn();
      })
      .catch((err) => console.error(err));

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const addFiles = useCallback(
    (paths: string[]) => {
      setItems((previous) => {
        const existing = new Set(previous.map((item) => item.path));
        const newItems: VectorizeItem[] = [];

        for (const path of paths) {
          const ext = getExtension(path);
          if (SUPPORTED_SET.has(ext) && !existing.has(path)) {
            newItems.push({
              path,
              name: getBasename(path),
              ext: ext.toUpperCase(),
              style: bottomBarStyle,
              status: 'ready',
              progress: 0,
            });
          }
        }

        return [...previous, ...newItems];
      });
    },
    [bottomBarStyle]
  );

  const changeStyle = useCallback((path: string, style: VectorizeStyle) => {
    setItems((all) =>
      all.map((item) =>
        item.path === path
          ? {
              ...item,
              style,
              status: item.status === 'completed' ? 'ready' : item.status,
            }
          : item
      )
    );
  }, []);

  const applyStyleToAll = useCallback((style: VectorizeStyle) => {
    setBottomBarStyle(style);
    setItems((all) =>
      all.map((item) => ({
        ...item,
        style,
        status: item.status === 'completed' ? 'ready' : item.status,
      }))
    );
  }, []);

  const applyStyleToSelected = useCallback(
    (style: VectorizeStyle) => {
      if (selectedPaths.length === 0) return;
      const selectedSet = new Set(selectedPaths);
      setItems((all) =>
        all.map((item) =>
          selectedSet.has(item.path)
            ? {
                ...item,
                style,
                status: item.status === 'completed' ? 'ready' : item.status,
              }
            : item
        )
      );
    },
    [selectedPaths]
  );

  const vectorizeSingle = useCallback(async (item: VectorizeItem) => {
    try {
      setActionError(null);
      setItems((all) =>
        all.map((i) =>
          i.path === item.path ? {...i, status: 'running', progress: 5, error: undefined} : i
        )
      );

      const targetOutput = outputForVectorize(item.path);
      const id = await enqueueVectorize({
        inputPath: item.path,
        outputPath: targetOutput,
        style: item.style,
        autoRenameOutputs: true,
      });

      jobPathsRef.current = {...jobPathsRef.current, [id]: item.path};

      if (pendingUpdates.current[id]) {
        const update = pendingUpdates.current[id];
        delete pendingUpdates.current[id];
        setItems((all) =>
          all.map((i) =>
            i.path === item.path
              ? {
                  ...i,
                  status: update.status,
                  progress: update.progress,
                  outputPath: update.outputPath ?? i.outputPath,
                  error: update.error ?? undefined,
                }
              : i
          )
        );
      }
    } catch (err) {
      setItems((all) =>
        all.map((i) =>
          i.path === item.path
            ? {...i, status: 'failed', progress: 0, error: String(err)}
            : i
        )
      );
    }
  }, []);

  const vectorizeMany = useCallback(
    (targets: VectorizeItem[]) => {
      const candidates = targets.filter(
        (i) => i.status === 'ready' || i.status === 'failed'
      );
      candidates.forEach((item) => void vectorizeSingle(item));
    },
    [vectorizeSingle]
  );

  const handleShowInFinder = useCallback(async (path: string) => {
    try {
      setActionError(null);
      await showInFinder(path);
    } catch (err) {
      setActionError(String(err));
    }
  }, []);

  const handleOpenSvg = useCallback(async (path: string) => {
    try {
      setActionError(null);
      await openOutputFile(path);
    } catch (err) {
      setActionError(String(err));
    }
  }, []);

  const removeItem = useCallback((path: string) => {
    setItems((all) => all.filter((item) => item.path !== path));
    setSelectedPaths((all) => all.filter((p) => p !== path));
  }, []);

  const removeCompleted = useCallback(() => {
    setItems((all) => all.filter((item) => item.status !== 'completed'));
    setSelectedPaths((all) =>
      all.filter((path) => items.find((i) => i.path === path)?.status !== 'completed')
    );
  }, [items]);

  const clearQueue = useCallback(() => {
    setItems([]);
    setSelectedPaths([]);
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedPaths.length === items.length) {
      setSelectedPaths([]);
    } else {
      setSelectedPaths(items.map((i) => i.path));
    }
  }, [items, selectedPaths]);

  const toggleSelect = useCallback((path: string) => {
    setSelectedPaths((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  }, []);

  const selectedItems = items.filter((i) => selectedPaths.includes(i.path));
  const completedCount = items.filter((i) => i.status === 'completed').length;
  const runningCount = items.filter((i) => i.status === 'running').length;
  const readyCount = items.filter((i) => i.status === 'ready' || i.status === 'failed').length;
  const selectedCompleted = selectedItems.filter((i) => i.status === 'completed' && i.outputPath);

  return (
    <section className="space-y-6">
      <header>
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-600/20 text-violet-400">
            <FontAwesomeIcon icon={faBezierCurve} className="text-xl" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">{t('vectorizeTitle')}</h1>
            <p className="mt-1 text-zinc-400">{t('vectorizeDescription')}</p>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 text-xs text-zinc-400">
          <p className="leading-relaxed">
            <strong className="text-zinc-200">{t('vectorizeNextToSourceNote')}</strong>{' '}
            {t('vectorizeSupportedInputs')}
          </p>
        </div>
      </header>


      {/* DropZone accepting PNG, JPG, GIF, BMP, TIFF, WebP */}
      <DropZone
        onFiles={(paths) => void addFiles(paths)}
        multiple
        allowedExtensions={SUPPORTED_EXTENSIONS}
        title={t('vectorizeDropTitle')}
        description={t('vectorizeDropDescription')}
      />

      {actionError && (
        <div
          role="alert"
          className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300"
        >
          {actionError}
        </div>
      )}

      {/* Queue Section */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{t('vectorizeQueue')}</h2>
            <p className="text-xs text-zinc-400">
              {t('concurrentProcesses', {count: parallelism})}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {completedCount > 0 && (
              <button
                type="button"
                onClick={removeCompleted}
                className="rounded-lg border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800"
              >
                {t('vectorizeRemoveCompleted')}
              </button>
            )}
            {items.length > 0 && (
              <button
                type="button"
                onClick={clearQueue}
                className="rounded-lg border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800"
              >
                {t('vectorizeClear')}
              </button>
            )}
            <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300">
              {t('fileCount', {count: items.length})}
            </span>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 p-8 text-center text-sm text-zinc-500">
            {t('vectorizeEmpty')}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Header / Select all bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={items.length > 0 && selectedPaths.length === items.length}
                  onChange={toggleSelectAll}
                />
                <span>
                  {selectedPaths.length === items.length
                    ? t('vectorizeDeselectAll')
                    : t('vectorizeSelectAll')}
                </span>
              </label>

              {selectedPaths.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-violet-950/70 px-2 py-1 text-violet-300">
                    {t('vectorizeSelectedCount', {count: selectedPaths.length})}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-400">{t('vectorizeSetStyleForSelected')}:</span>
                    <button
                      type="button"
                      onClick={() => applyStyleToSelected('logo')}
                      title={t('vectorizeStyleLogoDesc')}
                      className="rounded border border-zinc-700 px-2 py-0.5 hover:bg-zinc-800"
                    >
                      {t('vectorizeStyleLogo')}
                    </button>
                    <button
                      type="button"
                      onClick={() => applyStyleToSelected('photo')}
                      title={t('vectorizeStylePhotoDesc')}
                      className="rounded border border-zinc-700 px-2 py-0.5 hover:bg-zinc-800"
                    >
                      {t('vectorizeStylePhoto')}
                    </button>
                    <button
                      type="button"
                      onClick={() => applyStyleToSelected('bw')}
                      title={t('vectorizeStyleBwDesc')}
                      className="rounded border border-zinc-700 px-2 py-0.5 hover:bg-zinc-800"
                    >
                      {t('vectorizeStyleBw')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Item Rows */}
            <div className="space-y-2">
              {items.map((item) => {
                const isSelected = selectedPaths.includes(item.path);

                return (
                  <article
                    key={item.path}
                    className={`rounded-xl border p-4 transition ${
                      isSelected
                        ? 'border-violet-700/60 bg-violet-950/20'
                        : 'border-zinc-800 bg-zinc-900/70'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(item.path)}
                        aria-label={`Select ${item.name}`}
                      />

                      <span className="grid h-8 w-11 place-items-center rounded-md bg-zinc-800 text-[11px] font-bold text-zinc-300">
                        {item.ext}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-zinc-100">{item.name}</p>
                        <p className="truncate text-xs text-zinc-500">
                          {getDirectory(item.path)}
                        </p>
                      </div>

                      {/* Dropdown for per-image style */}
                      <div className="flex items-center gap-2">
                        <label
                          htmlFor={`style-select-${item.path}`}
                          className="text-xs text-zinc-400"
                        >
                          {t('vectorizeStyle')}
                        </label>
                        <select
                          id={`style-select-${item.path}`}
                          value={item.style}
                          disabled={item.status === 'running'}
                          onChange={(e) =>
                            changeStyle(item.path, e.target.value as VectorizeStyle)
                          }
                          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 disabled:opacity-50"
                        >
                          <option value="logo">{t('vectorizeStyleLogo')}</option>
                          <option value="photo">{t('vectorizeStylePhoto')}</option>
                          <option value="bw">{t('vectorizeStyleBw')}</option>
                        </select>
                      </div>

                      {/* Action buttons depending on status */}
                      {item.status !== 'completed' && (
                        <button
                          type="button"
                          onClick={() => void vectorizeSingle(item)}
                          disabled={item.status === 'running'}
                          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <FontAwesomeIcon icon={faPlay} className="text-[10px]" />
                          <span>{t('vectorizeAction')}</span>
                        </button>
                      )}

                      {item.status === 'completed' && item.outputPath && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleShowInFinder(item.outputPath!)}
                            className="flex items-center gap-1.5 rounded-lg border border-emerald-700 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/60"
                          >
                            <FontAwesomeIcon icon={faFolderOpen} className="text-[11px]" />
                            <span>{t('vectorizeShowInFinder')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleOpenSvg(item.outputPath!)}
                            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
                          >
                            <FontAwesomeIcon icon={faFileCode} className="text-[11px]" />
                            <span>{t('vectorizeOpenSvg')}</span>
                          </button>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => removeItem(item.path)}
                        disabled={item.status === 'running'}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Remove ${item.name}`}
                      >
                        ×
                      </button>
                    </div>

                    {/* Progress bar and status */}
                    <div className="mt-2.5 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className={`h-full rounded-full transition-all ${
                            item.status === 'completed'
                              ? 'bg-emerald-500'
                              : item.status === 'failed'
                              ? 'bg-red-500'
                              : 'bg-violet-500'
                          }`}
                          style={{
                            width: `${
                              item.status === 'completed'
                                ? 100
                                : item.status === 'running'
                                ? Math.max(item.progress, 15)
                                : item.status === 'failed'
                                ? 100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                      <span className="w-28 text-right text-xs text-zinc-400">
                        {item.status === 'ready' && t('statusReady')}
                        {item.status === 'running' && `${t('statusRunning')}…`}
                        {item.status === 'completed' && t('statusCompleted')}
                        {item.status === 'failed' && t('statusFailed')}
                      </span>
                    </div>

                    {/* Output path display when completed */}
                    {item.status === 'completed' && item.outputPath && (
                      <p className="mt-2 truncate text-xs text-emerald-400/90">
                        ✓ {getBasename(item.outputPath)} · {item.outputPath}
                      </p>
                    )}

                    {/* Error message when failed */}
                    {item.error && (
                      <p className="mt-2 text-xs text-red-400">{item.error}</p>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Bottom Bar: Global style picker & batch actions */}
      {items.length > 0 && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-700 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-md">
          {/* Style Picker in bottom bar */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              {t('vectorizeSetStyleForAll')}:
            </span>
            <div className="inline-flex rounded-xl border border-zinc-700 bg-zinc-900 p-0.5">
              <button
                type="button"
                onClick={() => applyStyleToAll('logo')}
                title={t('vectorizeStyleLogoDesc')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  bottomBarStyle === 'logo'
                    ? 'bg-violet-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t('vectorizeStyleLogo')}
              </button>
              <button
                type="button"
                onClick={() => applyStyleToAll('photo')}
                title={t('vectorizeStylePhotoDesc')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  bottomBarStyle === 'photo'
                    ? 'bg-violet-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t('vectorizeStylePhoto')}
              </button>
              <button
                type="button"
                onClick={() => applyStyleToAll('bw')}
                title={t('vectorizeStyleBwDesc')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  bottomBarStyle === 'bw'
                    ? 'bg-violet-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t('vectorizeStyleBw')}
              </button>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {selectedCompleted.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  selectedCompleted.forEach((i) => void handleShowInFinder(i.outputPath!));
                }}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-700/80 bg-emerald-950/40 px-3.5 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-900/60"
              >
                <FontAwesomeIcon icon={faFolderOpen} className="text-xs" />
                <span>
                  {t('vectorizeShowInFinder')} ({selectedCompleted.length})
                </span>
              </button>
            )}

            {selectedItems.length > 0 && (
              <button
                type="button"
                onClick={() => vectorizeMany(selectedItems)}
                disabled={
                  runningCount > 0 ||
                  !selectedItems.some((i) => i.status === 'ready' || i.status === 'failed')
                }
                className="rounded-lg bg-zinc-800 px-3.5 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
              >
                {t('vectorizeActionSelected', {
                  count: selectedItems.filter(
                    (i) => i.status === 'ready' || i.status === 'failed'
                  ).length,
                })}
              </button>
            )}

            <button
              type="button"
              onClick={() => vectorizeMany(items)}
              disabled={runningCount > 0 || readyCount === 0}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-lg hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FontAwesomeIcon icon={faBezierCurve} className="text-xs" />
              <span>
                {t('vectorizeActionAll', {count: readyCount || items.length})}
              </span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
