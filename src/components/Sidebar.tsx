import {NavLink} from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faExchangeAlt, faCompressAlt, faCropSimple, faImages, faGear } from "@fortawesome/free-solid-svg-icons";
import {useTranslation} from 'react-i18next';
import {openSettingsWindow} from '../lib/windows';

const Sidebar = () => {
  const {t} = useTranslation();
  const settingsShortcut = navigator.userAgent.includes('Mac') ? '⌘,' : 'Ctrl+,';

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-600 font-bold">B</div>
        <div>
          <h1 className="text-lg font-bold tracking-tight">Biolaris Media</h1>
          <p className="text-xs text-zinc-500">{t('local')}</p>
      </div>
      </div>
      <nav className="px-3">
        <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">{t('media')}</div>
        <NavLink
          to="/convert"
          className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}
        >
          <FontAwesomeIcon icon={faExchangeAlt} className="w-4"/>
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
        <NavLink
          to="/slideshow"
          className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}
        >
          <FontAwesomeIcon icon={faImages} className="w-4"/>
          <span>{t('slideshow')}</span>
        </NavLink>
      </nav>
      <div className="mt-auto space-y-3 px-3 py-4">
        <button
          type="button"
          onClick={() => void openSettingsWindow()}
          className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
        >
          <span className="flex items-center gap-2"><FontAwesomeIcon icon={faGear} className="w-4" /><span>{t('settings')}</span></span>
          <kbd className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500">{settingsShortcut}</kbd>
        </button>
        <div className="px-3"><span className="inline-block rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-400">{t('offline')}</span></div>
      </div>
    </aside>
  );
}

export default Sidebar;
