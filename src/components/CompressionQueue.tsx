import type {CompressionQuality} from '../lib/media';

export type CompressionQueueItem = {
  path: string;
  name: string;
  quality: CompressionQuality;
  status: 'ready' | 'running' | 'completed' | 'failed';
  progress: number;
  error?: string
};

type Props = {
  items: CompressionQueueItem[];
  onChange: (path: string, patch: Partial<CompressionQueueItem>) => void;
  onCompress: (item: CompressionQueueItem) => void;
  parallelism: number;
  onRemove: (path: string) => void;
  onRemoveCompleted: () => void;
  onClear: () => void;
};

const qualityOptions: CompressionQuality[] = [30, 40, 50, 60, 70];

const labels: Record<CompressionQueueItem['status'], string> = {
  ready: 'Pronto',
  running: 'In corso',
  completed: 'Completato',
  failed: 'Errore'
};

export function CompressionQueue({items, onChange, onCompress, parallelism, onRemove, onRemoveCompleted, onClear}: Readonly<Props>) {
  const hasCompleted = items.some((item) => item.status === 'completed');
  return <section className="mt-8">
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div><h2 className="text-lg font-semibold">Coda di compressione</h2><p className="text-sm text-zinc-400">Fino
        a {parallelism} processi simultanei</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {hasCompleted && <button onClick={onRemoveCompleted} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800">Rimuovi completati</button>}
        {items.length > 0 && <button onClick={onClear} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800">Svuota coda</button>}
        <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300">{items.length} file</span></div>
    </div>
    {items.length === 0 ?
      <div className="rounded-xl border border-zinc-800 p-8 text-center text-sm text-zinc-500">La coda è vuota</div> :
      <div className="space-y-3">{items.map((item) => <article key={item.path} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1"><p className="truncate font-medium">{item.name}</p><p
            className="truncate text-xs text-zinc-500">{item.path}</p></div>
          <label className="flex items-center gap-2 text-xs text-zinc-400">Qualità
            <select aria-label={`Qualità di compressione per ${item.name}`} value={item.quality} onChange={(e) => onChange(item.path, {quality: Number(e.target.value) as CompressionQuality})} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm">
              {qualityOptions.map((q) => <option key={q} value={q}>{q}%</option>)}
            </select>
          </label>
          <button disabled={item.status === 'running' || item.status === 'completed'} onClick={() => onCompress(item)} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">Comprimi
          </button>
          <button onClick={() => onRemove(item.path)} disabled={item.status === 'running'} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40" aria-label={`Rimuovi ${item.name}`}>×
          </button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-violet-500 transition-all" style={{width: `${item.progress}%`}}/>
          </div>
          <span className="w-24 text-right text-xs text-zinc-400">{labels[item.status]} · {item.progress}%</span></div>
        {item.error && <p className="mt-2 text-xs text-red-400">{item.error}</p>}
      </article>)}</div>}
  </section>;
}
