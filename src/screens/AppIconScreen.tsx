import {useCallback, useState} from 'react';
import {readFile} from '@tauri-apps/plugin-fs';
import {open} from '@tauri-apps/plugin-dialog';
import {useTranslation} from 'react-i18next';
import {DropZone} from '../components/DropZone';
import {createAppIcons, type AppIconInput, type AppIconPlatform, type AppIconPlatforms} from '../lib/appIcon';

const defaults: AppIconPlatforms = {windows:true, macos:true, ios:true, android:true, web:true};
const supported = new Set(['svg','png','jpg','jpeg','webp']);
const systems: {key: AppIconPlatform; label: string; detail: string}[] = [
  {key:'windows',label:'Windows',detail:'ICO · 16–256 px'}, {key:'macos',label:'macOS',detail:'iconset · fino a 1024 px'},
  {key:'ios',label:'iOS / Apple',detail:'AppIcon.appiconset · Xcode'}, {key:'android',label:'Android',detail:'mipmap · Play Store'},
  {key:'web',label:'Web / PWA',detail:'favicon · manifest PNG'},
];
const basename = (path: string) => path.split(/[\\/]/).pop() || path;

export function AppIconScreen() {
  const {t} = useTranslation();
  const [image, setImage] = useState<AppIconInput | null>(null);
  const [platforms, setPlatforms] = useState(defaults);
  const [outputDirectory, setOutputDirectory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outputs, setOutputs] = useState<string[]>([]);

  const addFiles = useCallback(async (paths: string[]) => {
    const path = paths[0];
    if (!path) return;
    const ext = path.match(/\.([^./\\]+)$/)?.[1]?.toLowerCase() || '';
    if (!supported.has(ext)) { setError(t('appIconUnsupported')); return; }
    setError(''); setOutputs([]); setBusy(true);
    try {
      const source = await readFile(path);
      const svg = ext === 'svg' ? new TextDecoder().decode(source) : undefined;
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      const bitmap = await createImageBitmap(new Blob([source as BlobPart], {type:mime}));
      let {width,height} = bitmap;
      if (svg) {
        // SVGs with only a viewBox are scalable even when they have no intrinsic pixel size.
        const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
        const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
        const svgWidth = Number.parseFloat(root.getAttribute('width') || '');
        const svgHeight = Number.parseFloat(root.getAttribute('height') || '');
        if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) { width = viewBox[2]; height = viewBox[3]; }
        else if (svgWidth > 0 && svgHeight > 0) { width = svgWidth; height = svgHeight; }
      }
      if (width !== height) throw new Error(t('appIconSquareError'));
      if (ext !== 'svg' && (width < 512 || height < 512)) throw new Error(t('appIconResolutionError'));
      let bytes: number[];
      if (svg) {
        // Rasterize vector artwork at 2048 px so macOS 2x assets retain ample detail.
        const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 2048;
        const context = canvas.getContext('2d');
        if (!context) throw new Error(t('appIconRasterError'));
        context.drawImage(bitmap, 0, 0, 2048, 2048); bitmap.close();
        const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(t('appIconRasterError'))), 'image/png'));
        bytes = Array.from(new Uint8Array(await png.arrayBuffer()));
      } else {
        bitmap.close(); bytes = Array.from(source);
      }
      setImage({path, name:basename(path), width, height, svg, bytes});
    } catch (reason) {
      setImage(null); setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }, [t]);

  const chooseOutput = async () => {
    const directory = await open({directory:true, multiple:false, title:t('appIconChooseOutput')});
    if (typeof directory === 'string') setOutputDirectory(directory);
  };

  const generate = async () => {
    if (!image || !outputDirectory || !Object.values(platforms).some(Boolean)) return;
    setBusy(true); setError(''); setOutputs([]);
    try { const result = await createAppIcons(image, outputDirectory, platforms); setOutputs(result.outputDirectories); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };

  const toggle = (key: AppIconPlatform) => setPlatforms(current => ({...current, [key]:!current[key]}));

  return <section className="space-y-6">
    <header><h1 className="text-3xl font-bold">{t('appIconTitle')}</h1><p className="mt-2 text-zinc-400">{t('appIconDescription')}</p></header>
    <DropZone onFiles={paths => void addFiles(paths)} imageOnly />
    {busy && <p className="rounded-lg bg-violet-500/10 p-3 text-sm text-violet-200">{t('appIconProcessing')}</p>}
    {image && <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm">
      <p className="font-medium">{image.name}</p><p className="mt-1 text-zinc-400">{image.svg ? t('appIconVector') : `${image.width} × ${image.height} px`}</p>
      {!image.svg && (image.width < 1024 || image.height < 1024) && <p className="mt-2 text-amber-300">{t('appIconIdealWarning')}</p>}
    </div>}
    {error && <p role="alert" className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
    <div><h2 className="mb-3 text-lg font-semibold">{t('appIconPlatforms')}</h2><div className="grid gap-3 sm:grid-cols-2">
      {systems.map(system => <label key={system.key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <input type="checkbox" checked={platforms[system.key]} onChange={() => toggle(system.key)} className="mt-1 accent-violet-500" />
        <span><span className="block font-medium">{system.label}</span><span className="text-xs text-zinc-400">{system.detail}</span></span>
      </label>)}
    </div></div>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => void chooseOutput()} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900">{outputDirectory || t('appIconChooseOutput')}</button>
      <button type="button" disabled={!image || !outputDirectory || busy || !Object.values(platforms).some(Boolean)} onClick={() => void generate()} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? t('appIconProcessing') : t('appIconCreate')}</button>
    </div>
    {outputs.length > 0 && <div role="status" className="rounded-xl border border-emerald-900 bg-emerald-950/30 p-4"><p className="mb-2 font-medium text-emerald-200">{t('appIconComplete')}</p>{outputs.map(path => <p key={path} className="break-all text-xs text-zinc-300">{path}</p>)}</div>}
  </section>;
}
