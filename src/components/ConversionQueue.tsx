import {detectFileType} from '../lib/media';
import {useState} from 'react';
import type {OutputFormat, FileType} from '../lib/media';
import {useTranslation} from 'react-i18next';
import {getConfiguredQuality} from '../lib/settings';

export type QueueItem = {
  path: string;
  name: string;
  format: OutputFormat;
  quality: number;
  status: 'ready' | 'running' | 'completed' | 'failed';
  progress: number;
  error?: string
};
type Props = {
  items: QueueItem[];
  onChange: (path: string, patch: Partial<QueueItem>) => void;
  onConvert: (item: QueueItem) => void;
  onConvertMany: (items: QueueItem[]) => void;
  parallelism: number;
  onRemove: (path: string) => void;
  onRemoveCompleted: () => void;
  onClear: () => void;
};
function getAvailableFormats(fileType: FileType): OutputFormat[] {
  switch (fileType) {
    case 'image':
    case 'raw':
      return ['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif', 'jxl', 'gif', 'bmp', 'tiff', 'tif', 'ico', 'tga', 'dds', 'hdr', 'exr', 'pcx', 'pbm', 'pgm', 'ppm', 'pnm'];
    case 'audio':
      return ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'];
    case 'video':
      return ['mp4', 'webm', 'mkv', 'avi', 'mov', 'gif'];
    case 'pdf':
      return ['jpg', 'png', 'webp'];
    default:
      return ['jpg', 'png', 'webp'];
  }
}

export function ConversionQueue({items, onChange, onConvert, onConvertMany, parallelism, onRemove, onRemoveCompleted, onClear}: Readonly<Props>) {
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const {t} = useTranslation();
  const statusLabels: Record<QueueItem['status'], string> = {
    ready: t('statusReady'),
    running: t('statusRunning'),
    completed: t('statusCompleted'),
    failed: t('statusFailed'),
  };
  const hasCompleted = items.some((item) => item.status === 'completed');
  const groups = new Map<string, QueueItem[]>();
  for (const item of items) {
    const detected = detectFileType(item.path);
    const typeKey = detected === 'raw' ? 'image' : detected;
    groups.set(typeKey, [...(groups.get(typeKey) ?? []), item]);
  }
  const selected = items.filter((item) => selectedPaths.includes(item.path));
  const readySelected = selected.filter((item) => item.status === 'ready' || item.status === 'failed');
  const selectedFormats = selected.length ? getAvailableFormats(detectFileType(selected[0].path)).filter((format) => selected.every((item) => getAvailableFormats(detectFileType(item.path)).includes(format))) : [];
  const selectedFormat = selectedFormats.includes(selected[0]?.format) ? selected[0].format : selectedFormats[0];
  const selectedQuality = selected[0]?.quality ?? 23;
  
  return <section className="mt-8">
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div><h2 className="text-lg font-semibold">{t('conversionQueue')}</h2><p className="text-sm text-zinc-400">{t('concurrentProcesses', {count: parallelism})}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {hasCompleted && <button onClick={onRemoveCompleted} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800">{t('removeCompleted')}</button>}
        {items.length > 0 && <button onClick={onClear} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800">{t('clearQueue')}</button>}
        <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300">{t('fileCount', {count: items.length})}</span></div>
    </div>
    {items.length === 0 ? (
      <div className="rounded-xl border border-zinc-800 p-8 text-center text-sm text-zinc-500">{t('emptyQueue')}</div>
    ) : (
      <>
      {groups.size > 0 && <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
        <span className="text-sm font-medium">{t('selectAll')}</span>
        {[...groups].map(([typeKey, group]) => {
          const paths = group.map((item) => item.path);
          const allSelected = paths.every((path) => selectedPaths.includes(path));
          const typeNames: Record<string, string> = {image: t('images'), video: t('videos'), audio: t('audio'), pdf: t('pdf')};
          return <label key={typeKey} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allSelected} onChange={() => setSelectedPaths((current) => allSelected ? current.filter((path) => !paths.includes(path)) : [...new Set([...current, ...paths])])} />
            {typeNames[typeKey] ?? typeKey}
          </label>;
        })}
      </div>}
      {selected.length > 0 && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-violet-700/50 bg-violet-950/30 p-3">
        <span className="text-sm">{t('selectedCount', {count: selected.length})}</span>
        <select aria-label={t('outputFormatForSelected')} value={selectedFormat ?? ''} disabled={!selectedFormats.length} onChange={(e) => readySelected.forEach((item) => {
          const format = e.target.value as OutputFormat;
          onChange(item.path, {format, quality: getConfiguredQuality(detectFileType(item.path), format)});
        })} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm">{selectedFormats.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select>
        <label className="flex items-center gap-2 text-xs text-zinc-400">{t('quality')} {selectedQuality}<input aria-label={t('qualityForSelected')} type="range" min="0" max="100" value={selectedQuality} onChange={(e) => readySelected.forEach((item) => onChange(item.path, {quality: Number(e.target.value)}))} className="w-24 accent-violet-500"/></label>
        <button disabled={!readySelected.length} onClick={() => onConvertMany(readySelected)} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:opacity-40">{t('convertSelected', {count: readySelected.length})}</button>
        <button onClick={() => setSelectedPaths([])} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800">{t('deselectAll')}</button>
      </div>}
      <div className="space-y-3">{items.map((item) => {
        const availableFormats = getAvailableFormats(detectFileType(item.path));
        
        return (
          <article key={item.path} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input type="checkbox" aria-label={t('selectFile', {name: item.name})} checked={selectedPaths.includes(item.path)} onChange={() => setSelectedPaths((current) => current.includes(item.path) ? current.filter((path) => path !== item.path) : [...current, item.path])} />
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{item.name}</p><p
                className="truncate text-xs text-zinc-500">{item.path}</p></div>
              {selected.length === 0 && <select aria-label={t('outputFormatFor', {name: item.name})} value={item.format} onChange={(e) => {
                const format = e.target.value as OutputFormat;
                onChange(item.path, {format, quality: getConfiguredQuality(detectFileType(item.path), format)});
              }} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm">{availableFormats.map((f) =>
                <option key={f} value={f}>{f.toUpperCase()}</option>
              )}</select>}
              {selected.length === 0 && <label className="flex items-center gap-2 text-xs text-zinc-400">{t('quality')} {item.quality}<input
                aria-label={t('qualityFor', {name: item.name})} type="range" min="0" max="100" value={item.quality}
                onChange={(e) => onChange(item.path, {quality: Number(e.target.value)})}
                className="w-24 accent-violet-500"/></label>}
              {selected.length === 0 && <button disabled={item.status === 'running' || item.status === 'completed'} onClick={() => onConvert(item)} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">{t('convertFile')}
              </button>
              }
              <button onClick={() => onRemove(item.path)} disabled={item.status === 'running'} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40" aria-label={t('removeFile', {name: item.name})}>×
              </button>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-violet-500 transition-all" style={{width: `${item.progress}%`}}/>
              </div>
              <span className="w-24 text-right text-xs text-zinc-400">{statusLabels[item.status]} · {item.progress}%</span>
            </div>
            {item.error && <p className="mt-2 text-xs text-red-400">{item.error}</p>}
          </article>
        );
      })}
      </div>
      </>
    )}
  </section>;
}
