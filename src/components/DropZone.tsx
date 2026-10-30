import React, {useEffect, useState} from 'react';
import {getCurrentWebview} from '@tauri-apps/api/webview';
import {open} from '@tauri-apps/plugin-dialog'
import {useTranslation} from 'react-i18next';

type Props = { onFiles: (paths: string[]) => void; imageOnly?: boolean; videoOnly?: boolean; multiple?: boolean };

const imageExtensions = [
  'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'svg'
];
const imageExtensionSet = new Set(imageExtensions);
const videoExtensions = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'f4v', 'vob', 'ogv', 'ogm', 'qt', 'm4v', 'mpg', 'mpeg', 'm2v', '3gp', '3g2', 'ts', 'mts', 'm2ts', 'm2t', 'asf', 'rm', 'rmvb', 'divx', 'xvid', 'dv', 'amv', 'mjpeg', 'mjpg', 'roq', 'yuv', 'nut'];
const videoExtensionSet = new Set(videoExtensions);

function pathsForDrop(paths: string[], imageOnly: boolean, videoOnly: boolean, multiple: boolean) {
  const filteredPaths = imageOnly
    ? paths.filter((path) => imageExtensionSet.has(path.split('.').pop()?.toLowerCase() || ''))
    : videoOnly ? paths.filter((path) => videoExtensionSet.has(path.split('.').pop()?.toLowerCase() || '')) : paths;
  return multiple ? filteredPaths : filteredPaths.slice(0, 1);
}

/** Uses Tauri's native file-drop event, which supplies real local filesystem paths. */
export function DropZone({onFiles, imageOnly = false, videoOnly = false, multiple = false}: Readonly<Props>) {
  const [hovering, setHovering] = useState(false);
  const {t} = useTranslation();

  const handleFileSelect = async () => {
    try {
      const selected = await open({
        multiple: imageOnly || videoOnly ? multiple : true,
        filters: [{
          name: t(imageOnly ? 'images' : videoOnly ? 'videos' : 'mediaAndDocuments'),
          extensions: imageOnly ? imageExtensions : videoOnly ? videoExtensions : [
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

      const paths: string[] = typeof selected === 'string' ? [selected] : selected;

      onFiles(pathsForDrop(paths, imageOnly, videoOnly, multiple));
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
      if (event.payload.type === 'drop') onFiles(pathsForDrop(event.payload.paths, imageOnly, videoOnly, multiple));
    })
      .then((fn) => { if (alive) unlisten = fn; else fn(); })
      .catch((err) => { console.error(err); });

    return () => {
      alive = false;
      unlisten?.();
    };
  }, [imageOnly, videoOnly, multiple, onFiles]);

  return (
    <section
      className={`rounded-2xl border border-dashed p-3 text-center transition ${hovering ? 'border-violet-400 bg-violet-500/10' : 'border-zinc-700 bg-zinc-900/50'}`}>
      <div className="mx-auto mb-3 grid h-12 w-12 cursor-pointer place-items-center rounded-xl bg-zinc-800 text-2xl" onClick={handleFileSelect}>＋</div>
      <h2 className="text-lg font-medium">{t(imageOnly ? (multiple ? 'imagesDropTitle' : 'imageDropTitle') : videoOnly ? 'videosDropTitle' : 'dropTitle')}</h2>
      <p className="mt-1 text-sm text-zinc-400">{t(imageOnly ? (multiple ? 'imagesDropDescription' : 'imageDropDescription') : videoOnly ? 'videosDropDescription' : 'dropDescription')}</p>
    </section>
  );
}
