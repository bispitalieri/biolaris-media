import {NavLink} from "react-router-dom";
import {isTauri} from '@tauri-apps/api/core';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRightArrowLeft, faCompressAlt, faCropSimple, faImages, faGear, faIcons, faEraser, faLayerGroup, faDownload, faBezierCurve, faWaveSquare, faBookOpen, faObjectGroup, faImage, faScissors, faTableList } from "@fortawesome/free-solid-svg-icons";
import {useTranslation} from 'react-i18next';
import {openSettingsWindow} from '../lib/windows';
import {useUpdater} from '../lib/updater';
import packageJson from '../../package.json';

const Sidebar = () => {
  const {t} = useTranslation();
  const {update, stage, progress, showUpdate} = useUpdater();
  const settingsShortcut = navigator.userAgent.includes('Mac') ? '⌘,' : 'Ctrl+,';

  return (
    <aside className="sticky top-0 flex h-screen min-h-0 w-64 shrink-0 flex-col overflow-hidden border-r border-zinc-800 bg-zinc-950">
      <div className="flex shrink-0 items-center gap-3 px-6 py-6">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-600 font-bold">B</div>
        <div>
          <h1 className="text-lg font-bold tracking-tight">Biolaris Media</h1>
          <p className="text-xs text-zinc-500">{t('local')}</p>
        </div>
      </div>
      <nav className="app-scrollbar min-h-0 flex-1 overflow-y-auto px-3">
        <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">{t('media')}</div>
        <NavLink
          to="/convert"
          className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}
        >
          <FontAwesomeIcon icon={faArrowRightArrowLeft} className="w-4"/>
          <span>{t('convert')}</span>
        </NavLink>
        <NavLink
          to="/compress"
          className={({isActive}) => `flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}
        >
          <FontAwesomeIcon icon={faCompressAlt} className="w-4"/>
          <span>{t('compress')}</span>
        </NavLink>
        <NavLink
          to="/crop"
          className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}
        >
          <FontAwesomeIcon icon={faCropSimple} className="w-4"/>
          <span>{t('crop')}</span>
        </NavLink>
        <NavLink to="/combine-videos" className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}>
          <FontAwesomeIcon icon={faLayerGroup} className="w-4"/><span>{t('combineVideos')}</span>
        </NavLink>
        <NavLink
          to="/slideshow"
          className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}
        >
          <FontAwesomeIcon icon={faImages} className="w-4"/>
          <span>{t('slideshow')}</span>
        </NavLink>
        <NavLink
          to="/app-icon"
          className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}
        >
          <FontAwesomeIcon icon={faIcons} className="w-4" />
          <span>{t('appIcon')}</span>
        </NavLink>
        <NavLink
          to="/remove-background"
          className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}
        >
          <FontAwesomeIcon icon={faEraser} className="w-4"/>
          <span>{t('removeBackground')}</span>
        </NavLink>
        <NavLink to="/vectorize" className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}>
          <FontAwesomeIcon icon={faBezierCurve} className="w-4"/><span>{t('vectorize')}</span>
        </NavLink>
        <NavLink to="/download-video" className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}>
          <FontAwesomeIcon icon={faDownload} className="w-4"/><span>{t('downloadVideo')}</span>
        </NavLink>
        <div className="mb-2 mt-4 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">{t('audio')}</div>
        <NavLink to="/merge-audio" className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}>
          <FontAwesomeIcon icon={faWaveSquare} className="w-4"/><span>{t('mergeAudio')}</span>
        </NavLink>
        <NavLink to="/split-by-chapter" className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}>
          <FontAwesomeIcon icon={faBookOpen} className="w-4"/><span>{t('splitByChapter')}</span>
        </NavLink>
        <div className="mb-2 mt-4 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">{t('pdf')}</div>
        <NavLink to="/combine-pdfs" className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}>
          <FontAwesomeIcon icon={faObjectGroup} className="w-4"/><span>{t('combinePdfs')}</span>
        </NavLink>
        <NavLink to="/images-to-pdf" className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}>
          <FontAwesomeIcon icon={faImage} className="w-4"/><span>{t('imagesToPdf')}</span>
        </NavLink>
        <NavLink to="/split-pdfs" className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}>
          <FontAwesomeIcon icon={faScissors} className="w-4"/><span>{t('splitPdfs')}</span>
        </NavLink>
        {isTauri() && <NavLink to="/organize-pages" className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}>
          <FontAwesomeIcon icon={faTableList} className="w-4"/><span>{t('organizePages')}</span>
        </NavLink>}
      </nav>
      <div className="mt-auto shrink-0 space-y-3 px-3 py-4">
        <button
          type="button"
          onClick={() => void openSettingsWindow()}
          className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
        >
          <span className="flex items-center gap-2"><FontAwesomeIcon icon={faGear} className="w-4" /><span>{t('settings')}</span></span>
          <kbd className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500">{settingsShortcut}</kbd>
        </button>
        <div className="flex items-center justify-between gap-2 px-3">
          <span className="inline-block rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-400">{t('offline')}</span>
          <button
            type="button"
            onClick={showUpdate}
            aria-label={update ? t('updateVersionBadge', {version: update.version}) : `Version ${packageJson.version}`}
            title={update ? t('updateVersionBadge', {version: update.version}) : `Version ${packageJson.version}`}
            className={`inline-block rounded-full border px-3 py-1 text-xs transition ${update ? 'border-violet-500/50 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20' : 'border-zinc-800 text-zinc-500'}`}
          >
            {stage === 'downloading' ? `${progress.toFixed(0)}%` : update ? `v${packageJson.version} · ${t('updateBadgeNew')}` : `v${packageJson.version}`}
          </button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
