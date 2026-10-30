import {useCallback, useEffect, useState} from 'react';
import {readFile} from '@tauri-apps/plugin-fs';
import {useTranslation} from 'react-i18next';
import {useAppSettings} from '../lib/settings';
import {DropZone} from '../components/DropZone';
import {detectFileType, openOutputDirectory, openOutputFile, saveBackgroundRemovedPng} from '../lib/media';

type SourceImage = {path: string; name: string; url: string; width: number; height: number};
type Status = 'ready' | 'loading-model' | 'processing' | 'saving' | 'completed' | 'failed';
type ProgressInfo = {status?: string; progress?: number; file?: string; name?: string};

const modelId = 'studioludens/birefnet-lite-512';
const modelRevision = '962e67969ec6acec9c19fab76acee4f5e22e990c';
let segmenterPromise: ReturnType<typeof createSegmenter> | null = null;
let segmenterDevice: 'webgpu' | 'wasm' = 'wasm';
const supported = new Set(['jpg', 'jpeg', 'png', 'webp']);
const extension = (path: string) => path.match(/\.([^./\\]+)$/)?.[1]?.toLowerCase() || '';
const basename = (path: string) => path.split(/[\\/]/).pop() || path;
const outputFor = (path: string) => `${path.replace(/\.[^./\\]*$/, '')}-no-background.png`;
const mimeFor = (ext: string) => ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;

async function preferredDevice(): Promise<'webgpu' | 'wasm'> {
  const gpu = (navigator as Navigator & {gpu?: {requestAdapter: () => Promise<unknown | null>}}).gpu;
  if (!gpu) return 'wasm';
  try { return await gpu.requestAdapter() ? 'webgpu' : 'wasm'; }
  catch { return 'wasm'; }
}

async function createSegmenter(onProgress: (progress: ProgressInfo) => void, device: 'webgpu' | 'wasm') {
  const {pipeline, env} = await import('@huggingface/transformers');
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  return pipeline('background-removal', modelId, {
    revision: modelRevision,
    device,
    dtype: device === 'webgpu' ? 'fp16' : 'fp32',
    progress_callback: (progress) => onProgress(progress as ProgressInfo),
  });
}

function canFallbackToWasm(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return !/fetch|network|http|download|not found|404/.test(message);
}

async function runBackgroundRemoval(
  source: Blob,
  onProgress: (progress: ProgressInfo) => void,
  onFallbackStart: () => void,
  onReady: () => void,
) {
  if (!segmenterPromise) {
    segmenterDevice = await preferredDevice();
    segmenterPromise = createSegmenter(onProgress, segmenterDevice);
  }

  let segmenter: Awaited<ReturnType<typeof createSegmenter>> | undefined;
  try {
    segmenter = await segmenterPromise;
    onReady();
    return await segmenter(source);
  } catch (error) {
    if (segmenterDevice !== 'webgpu' || !canFallbackToWasm(error)) throw error;
    await segmenter?.dispose();
    segmenterDevice = 'wasm';
    onFallbackStart();
    segmenterPromise = createSegmenter(onProgress, 'wasm');
    const fallback = await segmenterPromise;
    onReady();
    return fallback(source);
  }
}

function encodeBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function RemoveBackgroundScreen() {
  const {t} = useTranslation();
  const {settings} = useAppSettings();
  const [image, setImage] = useState<SourceImage | null>(null);
  const [resultUrl, setResultUrl] = useState('');
  const [status, setStatus] = useState<Status>('ready');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [openError, setOpenError] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [loading, setLoading] = useState(false);
  const busy = status === 'loading-model' || status === 'processing' || status === 'saving';

  useEffect(() => {
    if (!image?.url) return;
    return () => URL.revokeObjectURL(image.url);
  }, [image?.url]);
  useEffect(() => {
    if (!resultUrl) return;
    return () => URL.revokeObjectURL(resultUrl);
  }, [resultUrl]);

  const loadImage = useCallback(async (path: string) => {
    setLoading(true); setError(''); setOpenError(''); setOutputPath(''); setResultUrl(''); setStatus('ready'); setProgress(0);
    try {
      const ext = extension(path);
      if (detectFileType(path) !== 'image' || !supported.has(ext)) {
        setError(t('removeBackgroundUnsupported'));
        return;
      }
      const bytes = await readFile(path);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], {type:mimeFor(ext)}));
      setImage({path, name:basename(path), url, width:0, height:0});
    } catch (reason) { setError(t('cropPreviewError', {error:String(reason)})); }
    finally { setLoading(false); }
  }, [t]);

  const addFiles = useCallback(async (paths: string[]) => {
    if (busy || loading) return;
    const path = paths[0];
    if (!path) return;
    if (detectFileType(path) !== 'image' || !supported.has(extension(path))) { setError(t('removeBackgroundUnsupported')); return; }
    await loadImage(path);
  }, [busy, loadImage, loading, t]);

  const removeBackground = async () => {
    if (!image) return;
    setStatus('loading-model'); setProgress(0); setError(''); setOpenError(''); setOutputPath(''); setResultUrl('');
    try {
      const updateLoadProgress = (info: ProgressInfo) => {
        if (typeof info.progress === 'number') setProgress(Math.max(0, Math.min(99, Math.round(info.progress))));
      };
      const source = await fetch(image.url).then(response => {
        if (!response.ok) throw new Error(t('removeBackgroundReadError'));
        return response.blob();
      });
      const output = await runBackgroundRemoval(source, updateLoadProgress, () => {
        setStatus('loading-model'); setProgress(0);
      }, () => {
        setStatus('processing');
        setProgress(0);
      });
      if (output.width !== image.width || output.height !== image.height) {
        throw new Error(t('removeBackgroundDimensionError'));
      }
      setProgress(95);
      const png = await output.toBlob('image/png');
      const preview = URL.createObjectURL(png);
      setResultUrl(preview);
      setStatus('saving');
      const pngBase64 = encodeBase64(new Uint8Array(await png.arrayBuffer()));
      const savedPath = await saveBackgroundRemovedPng({
        outputPath:outputFor(image.path),
        pngBase64,
        autoRenameOutputs:settings.general.autoRenameOutputs,
      });
      setOutputPath(savedPath); setStatus('completed'); setProgress(100);
    } catch (reason) {
      segmenterPromise = null;
      segmenterDevice = 'wasm';
      setStatus('failed'); setError(String(reason));
    }
  };

  const openSavedFile = async () => {
    if (!outputPath) return;
    setOpenError('');
    try { await openOutputFile(outputPath); }
    catch (reason) { setOpenError(t('removeBackgroundOpenOutputError', {error:String(reason)})); }
  };

  const openSavedDirectory = async () => {
    if (!outputPath) return;
    setOpenError('');
    try { await openOutputDirectory(outputPath); }
    catch (reason) { setOpenError(t('removeBackgroundOpenOutputError', {error:String(reason)})); }
  };

  const currentPreview = resultUrl || image?.url;

  return <section className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">{t('removeBackgroundTitle')}</h1>
      <p className="mt-2 text-zinc-400">{t('removeBackgroundDescription')}</p>
      <p className="mt-2 text-xs text-zinc-500">{t('removeBackgroundModelNote')}</p>
    </header>
    <DropZone onFiles={paths => void addFiles(paths)} imageOnly />
    {loading && <p className="text-sm text-zinc-400">{t('cropLoading')}</p>}
    {busy && <div role="status" aria-live="polite" className="rounded-lg border border-violet-900/60 bg-violet-950/30 p-3 text-sm text-violet-200">
      <div className="flex justify-between gap-3"><span>{t(status === 'loading-model' ? 'removeBackgroundLoadingModel' : status === 'processing' ? 'removeBackgroundProcessing' : 'removeBackgroundSaving')}</span><span>{progress}%</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-violet-500 transition-all" style={{width:`${Math.max(progress, status === 'processing' ? 5 : 0)}%`}}/></div>
    </div>}
    {error && <p role="alert" className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5">
      {image && currentPreview ? <>
      <div className="mb-4"><h2 className="font-medium">{image.name}</h2><p className="mt-1 text-xs text-zinc-500">{image.width > 0 ? `${image.width} × ${image.height} px · PNG` : image.path}</p></div>
      <div className="flex min-h-56 items-center justify-center overflow-auto rounded-xl bg-[linear-gradient(45deg,#27272a_25%,transparent_25%),linear-gradient(-45deg,#27272a_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#27272a_75%),linear-gradient(-45deg,transparent_75%,#27272a_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0] p-3">
        <img src={currentPreview} alt={image.name} draggable={false}
          onLoad={event => { const element = event.currentTarget; setImage(current => current?.path === image.path ? {...current,width:element.naturalWidth,height:element.naturalHeight} : current); }}
          onError={() => setError(t('cropImageDecodeError'))} className="block max-h-[55vh] max-w-full rounded-lg object-contain" />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">{resultUrl ? t('removeBackgroundPreview') : t('removeBackgroundHint')}</p>
        {status !== 'completed' && <button type="button" onClick={() => void removeBackground()} disabled={busy || loading || image.width === 0}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? t(status === 'loading-model' ? 'removeBackgroundLoadingModel' : status === 'processing' ? 'removeBackgroundProcessing' : 'removeBackgroundSaving') : t('removeBackgroundAction')}
        </button>}
      </div>
      </> : <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed border-zinc-800 text-sm text-zinc-500">
        {t('removeBackgroundEmptyPreview')}
      </div>}
      {status === 'completed' && outputPath && <>
        <p className="mt-4 break-all rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">{t('removeBackgroundSaved')}: {outputPath}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" onClick={() => void openSavedFile()} className="rounded-lg border border-emerald-800/70 px-4 py-2 text-sm text-emerald-200 hover:bg-emerald-950/50">{t('removeBackgroundOpenOutputFile')}</button>
          <button type="button" onClick={() => void openSavedDirectory()} className="rounded-lg border border-emerald-800/70 px-4 py-2 text-sm text-emerald-200 hover:bg-emerald-950/50">{t('removeBackgroundOpenOutputDirectory')}</button>
        </div>
        {openError && <p role="alert" className="mt-2 text-sm text-red-400">{openError}</p>}
      </>}
    </div>
  </section>;
}
