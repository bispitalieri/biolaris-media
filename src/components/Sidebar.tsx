import {NavLink} from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faExchangeAlt, faCompressAlt } from "@fortawesome/free-solid-svg-icons";
import {useTranslation} from 'react-i18next';
import {languageNames, type Language} from '../lib/i18n';

const Sidebar = () => {
  const {i18n, t} = useTranslation();
  const language: Language = i18n.resolvedLanguage ?? 'en';
  const languageOptions = Object.entries(languageNames).sort(([codeA, nameA], [codeB, nameB]) => {
    if (codeA === 'en') return -1;
    if (codeB === 'en') return 1;
    return nameA.localeCompare(nameB);
  });

  return (
    <aside className="w-64 border-r border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-600 font-bold">T</div>
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
      </nav>
      <div className="mt-auto space-y-4 px-6 py-4">
        <label className="block text-xs text-zinc-500">
          <span className="mb-1 block">{t('language')}</span>
          <select
            value={language}
            onChange={(event) => { void i18n.changeLanguage(event.target.value as Language); }}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
          >
            {languageOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <span className="inline-block rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-400">{t('offline')}</span>
      </div>
    </aside>
  );
}

export default Sidebar;
