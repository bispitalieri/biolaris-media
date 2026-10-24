import {detectFileType} from '../lib/media';
import type {OutputFormat, FileType} from '../lib/media';

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
  parallelism: number;
  onRemove: (path: string) => void;
  onRemoveCompleted: () => void;
  onClear: () => void;
};
const labels: Record<QueueItem['status'], string> = {
  ready: 'Pronto',
  running: 'In corso',
  completed: 'Completato',
  failed: 'Errore'
};

// Get available output formats for a given file type
function getAvailableFormats(fileType: FileType): OutputFormat[] {
  switch (fileType) {
    case 'image': return ['jpg', 'png', 'webp', 'gif', 'bmp', 'tiff'];
    case 'audio': return ['mp3', 'wav', 'flac'];
    case 'video': return ['mp4', 'webm'];
    case 'pdf': return ['pdf'];
    default: return [];
  }
}

export function ConversionQueue({items, onChange, onConvert, parallelism, onRemove, onRemoveCompleted, onClear}: Readonly<Props>) {
  const hasCompleted = items.some((item) => item.status === 'completed');
  
  return <section className="mt-8">
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div><h2 className="text-lg font-semibold">Coda di conversione</h2><p className="text-sm text-zinc-400">Fino
        a {parallelism} processi simultanei</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {hasCompleted && <button onClick={onRemoveCompleted} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800">Rimuovi completati</button>}
        {items.length > 0 && <button onClick={onClear} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800">Svuota coda</button>}
        <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300">{items.length} file</span></div>
    </div>
    {items.length === 0 ?
      <div className="rounded-xl border border-zinc-800 p-8 text-center text-sm text-zinc-500">La coda è vuota</div> :
      <div className="space-y-3">{items.map((item) => {
        const availableFormats = getAvailableFormats(detectFileType(item.path));
        
        return (
          <article key={item.path} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{item.name}</p><p
                className="truncate text-xs text-zinc-500">{item.path}</p></div>
              <select aria-label={`Formato di output per ${item.name}`} value={item.format} onChange={(e) => onChange(item.path, {format: e.target.value as OutputFormat})} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm">{availableFormats.map((f) =>
                <option key={f} value={f}>{f.toUpperCase()}</option>
              )}</select>
              <label className="flex items-center gap-2 text-xs text-zinc-400">Qualità {item.quality}<input
                aria-label={`Qualità per ${item.name}`} type="range" min="0" max="51" value={item.quality}
                onChange={(e) => onChange(item.path, {quality: Number(e.target.value)})}
                className="w-24 accent-violet-500"/></label>
              <button disabled={item.status === 'running' || item.status === 'completed'} onClick={() => onConvert(item)} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">Converti
              </button>
              <button onClick={() => onRemove(item.path)} disabled={item.status === 'running'} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40" aria-label={`Rimuovi ${item.name}`}>×
              </button>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-violet-500 transition-all" style={{width: `${item.progress}%`}}/>
              </div>
              <span className="w-24 text-right text-xs text-zinc-400">{labels[item.status]} · {item.progress}%</span>
            </div>
            {item.error && <p className="mt-2 text-xs text-red-400">{item.error}</p>}
          </article>
        );
      })}
      </div>}
  </section>;
}
