import React, {useEffect, useState} from 'react';
import {getCurrentWebview} from '@tauri-apps/api/webview';
import {open} from '@tauri-apps/plugin-dialog'
import {useTranslation} from 'react-i18next';

type Props = { onFiles: (paths: string[]) => void };

/** Uses Tauri's native file-drop event, which supplies real local filesystem paths. */
export function DropZone({onFiles}: Readonly<Props>) {
  const [hovering, setHovering] = useState(false);
  const {t} = useTranslation();

  const handleFileSelect = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: t('mediaAndDocuments'),
          extensions: [
            // === IMMAGINI & FOTO ===
            'jpg', 'jpeg', 'png', 'webp', 'webp2', 'heic', 'heif', 'avif', 'jxl', 'bpg', 'gif', 'bmp', 'tiff', 'tif', 'svg',
            'ico', 'icns', 'jfif', 'pjpeg', 'pjpg', 'ape', 'psd', 'ai', 'xcf', 'tga', 'dds', 'hdr', 'exr', 'wmf', 'emf', 'eps',
            'pcx', 'dcx', 'pbm', 'pgm', 'ppm', 'pnm', 'pdf',
            // Formati RAW (Fotografia)
            'cr2', 'cr3', 'nef', 'arw', 'sr2', 'dng', 'rw2', 'orf', 'pef', 'raf', 'mrw', 'x3f', 'erf', '3fr', 'fff',

            // === VIDEO & ANIMAZIONI ===
            'mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'f4v', 'vob', 'ogv', 'ogm', 'qt',
            'm4v', 'mpg', 'mpeg', 'm2v', '3gp', '3g2', 'ts', 'mts', 'm2ts', 'm2t', 'asf', 'rm', 'rmvb', 'divx', 'xvid', 'dv',
            'amv', 'mjpeg', 'mjpg', 'roq', 'yuv', 'nut',

            // === AUDIO ===
            'mp3', 'wav', 'ogg', 'oga', 'mka', 'flac', 'm4a', 'm4r', 'aac', 'adts', 'wma', 'alac', 'aiff', 'aif', 'ape',
            'pcm', 'opus', 'spx', 'amr', 'gsm', 'mid', 'midi', 'm4b', 'm4p', 'mpc', 'wv', 'dsf', 'dff', 'caf', 'tak', 'tta',
            'ra', 'ram', 'au', 'snd', 'voc'
          ]
        }]
      });
      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];

      onFiles(paths);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;

    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') setHovering(true);
      if (event.payload.type === 'leave' || event.payload.type === 'drop') setHovering(false);
      if (event.payload.type === 'drop') onFiles(event.payload.paths);
    })
      .then((fn) => { if (alive) unlisten = fn; else fn(); })
      .catch((err) => { console.error(err); });

    return () => {
      alive = false;
      unlisten?.();
    };
  }, [onFiles]);

  return (
    <section
      className={`rounded-2xl border border-dashed p-10 text-center transition ${hovering ? 'border-violet-400 bg-violet-500/10' : 'border-zinc-700 bg-zinc-900/50'}`}>
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-zinc-800 text-2xl cursor-pointer" onClick={handleFileSelect}>＋</div>
      <h2 className="text-lg font-medium">{t('dropTitle')}</h2>
      <p className="mt-1 text-sm text-zinc-400">{t('dropDescription')}</p>
    </section>
  );
}
