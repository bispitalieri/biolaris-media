import {useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent} from 'react';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faGripVertical, faTrash, faXmark} from '@fortawesome/free-solid-svg-icons';
import {useTranslation} from 'react-i18next';
import {DropZone} from '../components/DropZone';
import {
  openOutputDirectory,
  openOutputFile,
  organizePdfPages,
  renderPdfPage,
  renderPdfPages,
  type PdfPagePreview,
} from '../lib/media';

type Page = PdfPagePreview & {originalPage: number};
type ContextMenu = {x: number; y: number; page: number};
const pdfExtensions = ['pdf'];
const basename = (path: string) => path.split(/[\\/]/).pop() || path;

export function OrganizePagesScreen() {
  const {t} = useTranslation();
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{page: Page; path: string; dataUrl?: string; error?: string} | null>(null);
  const draggedPage = useRef<{
    pointerId: number;
    from: number;
    to: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [draggingPage, setDraggingPage] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<number | null>(null);
  const selectedRef = useRef(selectedPages);
  const activePdfPath = useRef<string | null>(null);
  const savingRef = useRef(false);
  selectedRef.current = selectedPages;
  const busy = loading || saving;

  const clearOutput = () => {
    setError(null);
    setOutputPath(null);
  };

  const addPdfs = useCallback((paths: string[]) => {
    const path = paths[0];
    if (!path || savingRef.current) return;
    activePdfPath.current = path;
    setPdfPath(path);
    setPages([]);
    setSelectedPages([]);
    setPreview(null);
    setLoading(true);
    setSaving(false);
    setOutputPath(null);
    setOpenError(null);
    setError(null);
    void renderPdfPages(path).then((previews) => {
      if (activePdfPath.current === path) {
        setPages(previews.map((page) => ({...page, originalPage: page.pageNumber})));
      }
    }).catch((reason: unknown) => {
      if (activePdfPath.current === path) setError(String(reason));
    }).finally(() => {
      if (activePdfPath.current === path) {
        setLoading(false);
      }
    });
  }, []);

  const removePages = useCallback((pageNumbers: number[]) => {
    const removing = new Set(pageNumbers);
    const remaining = pages.filter(({originalPage}) => !removing.has(originalPage));
    if (!remaining.length && pages.length) {
      setError(t('organizePagesKeepOne'));
      setContextMenu(null);
      return;
    }
    setPages(remaining);
    setSelectedPages((current) => current.filter((page) => !removing.has(page)));
    setContextMenu(null);
    clearOutput();
  }, [pages, t]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (busy || !['Delete', 'Backspace'].includes(event.key)) return;
      const target = event.target;
      if (target instanceof HTMLElement
        && (target.isContentEditable
          || (target instanceof HTMLInputElement && target.type !== 'checkbox')
          || ['TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (!selectedRef.current.length) return;
      event.preventDefault();
      removePages(selectedRef.current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, removePages]);

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

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview]);

  const movePage = (from: number, to: number) => {
    if (from === to || to < 0 || to >= pages.length) return;
    setPages((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    clearOutput();
  };

  const startPageDrag = (event: ReactPointerEvent<HTMLElement>, index: number) => {
    if (busy || event.button !== 0) return;
    if (event.target instanceof Element
      && event.target.closest('input, button:not([data-page-preview]):not([data-page-drag-handle])')) return;
    draggedPage.current = {
      pointerId: event.pointerId,
      from: index,
      to: index,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = draggedPage.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      if (!drag.active) {
        drag.active = true;
        const page = pages[drag.from];
        setDraggingPage(page?.originalPage ?? null);
      }
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-page-index]');
      const index = Number(target?.dataset.pageIndex);
      if (Number.isInteger(index) && index >= 0 && index < pages.length && drag.to !== index) {
        drag.to = index;
        setDropPosition(index);
      }
      event.preventDefault();
    };
    const finishDrag = (event: PointerEvent) => {
      const drag = draggedPage.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      draggedPage.current = null;
      setDraggingPage(null);
      setDropPosition(null);
      if (drag.active) {
        suppressClick.current = true;
        window.setTimeout(() => { suppressClick.current = false; }, 0);
        movePage(drag.from, drag.to);
      }
    };
    const cancelDrag = (event: PointerEvent) => {
      if (draggedPage.current?.pointerId !== event.pointerId) return;
      draggedPage.current = null;
      setDraggingPage(null);
      setDropPosition(null);
    };
    window.addEventListener('pointermove', onPointerMove, {passive: false});
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', cancelDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', cancelDrag);
    };
  }, [pages]);

  const openPreview = async (page: Page) => {
    const path = pdfPath;
    if (!path) return;
    setPreview({page, path});
    try {
      const dataUrl = await renderPdfPage(path, page.originalPage);
      setPreview((current) => current?.path === path && current.page.originalPage === page.originalPage
        ? {...current, dataUrl}
        : current);
    } catch (reason) {
      setPreview((current) => current?.path === path && current.page.originalPage === page.originalPage
        ? {...current, error: String(reason)}
        : current);
    }
  };

  const save = async () => {
    if (!pdfPath || !pages.length || busy) return;
    savingRef.current = true;
    setSaving(true);
    clearOutput();
    try {
      const output = await organizePdfPages(pdfPath, pages.map(({originalPage}) => originalPage));
      setOutputPath(output);
    } catch (reason) {
      setError(String(reason));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const openMenu = (event: MouseEvent, page: number) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedPages.includes(page)) setSelectedPages([page]);
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 80),
      page,
    });
  };

  return <>
    <header className="mb-8">
      <h1 className="text-xl font-bold tracking-tight">{t('organizePagesTitle')}</h1>
      <p className="text-sm text-zinc-500">{t('organizePagesDescription')}</p>
    </header>
    <DropZone
      onFiles={addPdfs}
      allowedExtensions={pdfExtensions}
      title={t('organizePagesDropTitle')}
      description={t('organizePagesDropDescription')}
    />

    {pdfPath && <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{t('organizePagesList')}</h2>
          <p className="truncate text-sm text-zinc-400">{basename(pdfPath)}</p>
          {!loading && pages.length > 0 && <p className="text-xs text-zinc-500">
            {t('organizePagesCount', {count: pages.length})}
          </p>}
          <p className="text-xs text-zinc-500">{t('organizePagesHint')}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={!selectedPages.length || busy} onClick={() => removePages(selectedPages)}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 disabled:opacity-40">
            {t('organizePagesRemove')}
          </button>
          <button type="button" disabled={!pages.length || busy} onClick={() => void save()}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">
            {saving ? t('organizePagesSaving') : t('organizePagesSave')}
          </button>
        </div>
      </div>
      {loading && <div className="rounded-xl border border-zinc-800 p-8 text-center text-sm text-zinc-400">{t('organizePagesLoading')}</div>}
      {!loading && pages.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {pages.map((page, index) => <article key={page.originalPage}
          data-page-index={index}
          onPointerDown={(event) => startPageDrag(event, index)}
          onClickCapture={(event) => {
            if (!suppressClick.current) return;
            suppressClick.current = false;
            event.preventDefault();
            event.stopPropagation();
          }}
          onContextMenu={(event) => openMenu(event, page.originalPage)}
          className={`relative overflow-hidden rounded-xl border select-none transition duration-150 ${draggingPage === page.originalPage ? 'opacity-40 scale-[0.98]' : ''} ${dropPosition === index && draggingPage !== page.originalPage ? 'z-10 scale-[1.02] border-violet-300 ring-2 ring-violet-500 shadow-lg shadow-violet-500/20' : selectedPages.includes(page.originalPage) ? 'border-violet-500 bg-violet-950/30' : 'border-zinc-800 bg-zinc-900/60'}`}>
          {dropPosition === index && draggingPage !== page.originalPage && <div
            className="pointer-events-none absolute inset-x-2 top-2 z-10 rounded-md border border-violet-300/60 bg-violet-950/95 px-2 py-1 text-center text-xs font-semibold text-violet-100 shadow">
            {t('organizePagesMoveToPosition', {position: index + 1})}
          </div>}
          <button type="button" data-page-preview onClick={() => void openPreview(page)} disabled={busy}
            className="block w-full cursor-zoom-in bg-zinc-800 p-2 disabled:cursor-wait"
            aria-label={t('organizePagesPreview', {page: page.originalPage})}>
            <img src={page.dataUrl} alt={t('organizePagesPageAlt', {page: page.originalPage})} draggable={false}
              className="mx-auto h-40 w-full object-contain"/>
          </button>
          <div className="flex items-center gap-2 p-2">
            <input type="checkbox" aria-label={t('organizePagesSelect', {page: page.originalPage})}
              checked={selectedPages.includes(page.originalPage)} disabled={busy}
              onChange={() => setSelectedPages((current) => current.includes(page.originalPage)
                ? current.filter((value) => value !== page.originalPage)
                : [...current, page.originalPage])}
              className="accent-violet-500"/>
            <button type="button" data-page-drag-handle aria-label={t('organizePagesDragPage', {page: page.originalPage})}
              disabled={busy}
              className="cursor-grab touch-none text-zinc-500 active:cursor-grabbing disabled:cursor-not-allowed"
              title={t('organizePagesDragPage', {page: page.originalPage})}>
              <FontAwesomeIcon icon={faGripVertical}/>
            </button>
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">
              {t('organizePagesPageNumber', {page: index + 1, original: page.originalPage})}
            </span>
            <button type="button" aria-label={t('organizePagesRemovePage', {page: page.originalPage})}
              disabled={busy || pages.length === 1}
              onClick={() => removePages([page.originalPage])}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-red-950/60 hover:text-red-300 disabled:opacity-30">
              <FontAwesomeIcon icon={faTrash} className="text-xs"/>
            </button>
          </div>
        </article>)}
      </div>}
    </section>}

    {(saving || outputPath) && <section className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4" aria-live="polite">
      <p className="text-sm">{saving ? t('organizePagesSaving') : t('organizePagesSaved')}</p>
      {outputPath && <>
        <p className="mt-2 break-all text-xs text-zinc-400">{outputPath}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => { setOpenError(null); void openOutputFile(outputPath).catch((reason) => setOpenError(String(reason))); }}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">{t('openOutputFile')}</button>
          <button type="button" onClick={() => { setOpenError(null); void openOutputDirectory(outputPath).catch((reason) => setOpenError(String(reason))); }}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">{t('openOutputDirectory')}</button>
        </div>
      </>}
    </section>}
    {openError && <p role="alert" className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{openError}</p>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}

    {contextMenu && <div role="menu" style={{left: contextMenu.x, top: contextMenu.y}}
      onClick={(event) => event.stopPropagation()}
      className="fixed z-50 min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl">
      <button type="button" role="menuitem" disabled={busy || pages.length === 1}
        onClick={() => removePages(selectedPages.includes(contextMenu.page) ? selectedPages : [contextMenu.page])}
        className="block w-full rounded px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-40">
        {t('organizePagesRemove')}
      </button>
    </div>}

    {preview && <div role="presentation" onClick={() => setPreview(null)}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
      <section role="dialog" aria-modal="true" aria-label={t('organizePagesPreview', {page: preview.page.originalPage})}
        onClick={(event) => event.stopPropagation()}
        className="relative flex max-h-full max-w-full flex-col items-center rounded-xl border border-zinc-700 bg-zinc-900 p-4">
        <button type="button" onClick={() => setPreview(null)} aria-label={t('close')}
          className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-zinc-800 text-zinc-200 hover:bg-zinc-700">
          <FontAwesomeIcon icon={faXmark}/>
        </button>
        <p className="mb-3 pr-10 text-sm text-zinc-300">
          {t('organizePagesPageNumber', {page: pages.findIndex(({originalPage}) => originalPage === preview.page.originalPage) + 1, original: preview.page.originalPage})}
        </p>
        {preview.dataUrl
          ? <img src={preview.dataUrl} alt={t('organizePagesPageAlt', {page: preview.page.originalPage})}
            className="max-h-[calc(100vh-9rem)] max-w-full object-contain"/>
          : preview.error
            ? <p role="alert" className="p-8 text-sm text-red-300">{preview.error}</p>
            : <p className="p-8 text-sm text-zinc-400">{t('organizePagesPreviewLoading')}</p>}
      </section>
    </div>}
  </>;
}
