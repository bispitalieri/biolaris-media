import {useCallback, useEffect, useState} from 'react';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faCheck, faFilePdf, faGear, faImage, faLanguage, faMoon, faMusic, faRocket, faVideo, faXmark} from '@fortawesome/free-solid-svg-icons';
import {disable, enable, isEnabled} from '@tauri-apps/plugin-autostart';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {isTauri} from '@tauri-apps/api/core';
import {useTranslation} from 'react-i18next';
import {languageNames} from '../lib/i18n';
import {MEDIA_FORMATS, type AppSettings, type MediaCategory, type ThemePreference, useAppSettings} from '../lib/settings';

type SettingsTab = 'general' | MediaCategory;

const tabIcons = {
  general: faGear,
  images: faImage,
  audio: faMusic,
  videos: faVideo,
  pdf: faFilePdf,
};

const mediaCategories: MediaCategory[] = ['images', 'audio', 'videos', 'pdf'];
const tabTranslationKeys: Record<SettingsTab, 'settingsTabGeneral' | 'settingsTabImages' | 'settingsTabAudio' | 'settingsTabVideos' | 'settingsTabPdf'> = {
  general: 'settingsTabGeneral',
  images: 'settingsTabImages',
  audio: 'settingsTabAudio',
  videos: 'settingsTabVideos',
  pdf: 'settingsTabPdf',
};
const mediaDescriptionKeys: Record<MediaCategory, 'settingsImagesDescription' | 'settingsAudioDescription' | 'settingsVideosDescription' | 'settingsPdfDescription'> = {
  images: 'settingsImagesDescription',
  audio: 'settingsAudioDescription',
  videos: 'settingsVideosDescription',
  pdf: 'settingsPdfDescription',
};
const selectClass = 'mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20';
const cardClass = 'rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5';

export function SettingsScreen() {
  const {t} = useTranslation();
  const {settings, updateSettings} = useAppSettings();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [autostartAvailable, setAutostartAvailable] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartError, setAutostartError] = useState('');

  useEffect(() => {
    const available = isTauri();
    setAutostartAvailable(available);
    if (available) {
      void isEnabled().then((enabled) => {
        updateSettings((current) => ({
          ...current,
          general: {...current.general, launchAtStartup: enabled},
        }));
      }).catch((error: unknown) => setAutostartError(String(error)));
    }
  }, [updateSettings]);

  useEffect(() => {
    if (isTauri()) {
      void getCurrentWindow().setDecorations(false);
    }
  }, []);

  const updateGeneral = (patch: Partial<AppSettings['general']>) => {
    updateSettings((current) => ({...current, general: {...current.general, ...patch}}));
  };

  const updateMedia = (category: MediaCategory, patch: Partial<AppSettings['media'][MediaCategory]>) => {
    updateSettings((current) => ({
      ...current,
      media: {...current.media, [category]: {...current.media[category], ...patch}},
    }));
  };

  const setFormatQuality = (category: MediaCategory, format: string, quality: number) => {
    updateSettings((current) => ({
      ...current,
      media: {
        ...current.media,
        [category]: {
          ...current.media[category],
          qualityByFormat: {...current.media[category].qualityByFormat, [format]: quality},
        },
      },
    }));
  };

  const setLaunchAtStartup = async (enabled: boolean) => {
    setAutostartError('');
    setAutostartBusy(true);
    try {
      if (enabled) await enable();
      else await disable();
      updateGeneral({launchAtStartup: enabled});
    } catch (error) {
      setAutostartError(String(error));
    } finally {
      setAutostartBusy(false);
    }
  };

  const closeWindow = useCallback(() => {
    if (isTauri()) {
      void getCurrentWindow().close();
    } else {
      window.close();
    }
  }, []);

  const tabName = (tab: SettingsTab) => t(tabTranslationKeys[tab]);
  const mediaTitle = (category: MediaCategory) => t(category);
  const mediaDescription = (category: MediaCategory) => t(mediaDescriptionKeys[category]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-5xl px-7 pb-10 pt-7">
        <header className="mb-6 flex items-start justify-between gap-5">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-600/15 text-violet-300">
              <FontAwesomeIcon icon={faGear} />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-violet-300">Biolaris Media</p>
              <h1 className="text-2xl font-bold tracking-tight">{t('settingsTitle')}</h1>
              <p className="mt-1 text-sm text-zinc-400">{t('settingsDescription')}</p>
            </div>
          </div>
          <button onClick={closeWindow} aria-label={t('close')} className="grid h-9 w-9 place-items-center rounded-xl border border-zinc-800 text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100 cursor-pointer">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        <nav aria-label={t('settingsCategories')} className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/60 p-1.5">
          {(['general', ...mediaCategories] as SettingsTab[]).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`flex min-w-fit flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition ${activeTab === tab ? 'bg-violet-600 text-white shadow-sm shadow-violet-950/40' : 'text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100'}`}
            >
              <FontAwesomeIcon icon={tabIcons[tab]} className="text-xs" />
              {tabName(tab)}
            </button>
          ))}
        </nav>

        <section role="tabpanel" aria-label={tabName(activeTab)}>
          {activeTab === 'general' ? (
            <GeneralSettings
              settings={settings}
              autostartAvailable={autostartAvailable}
              autostartBusy={autostartBusy}
              autostartError={autostartError}
              onLanguageChange={(language) => updateGeneral({language})}
              onThemeChange={(theme) => updateGeneral({theme})}
              onAutoRenameOutputsChange={(enabled) => updateGeneral({autoRenameOutputs: enabled})}
              onAutostartChange={(enabled) => void setLaunchAtStartup(enabled)}
            />
          ) : (
            <MediaSettings
              category={activeTab}
              settings={settings}
              title={mediaTitle(activeTab)}
              description={mediaDescription(activeTab)}
              onDefaultFormatChange={(defaultFormat) => updateMedia(activeTab, {defaultFormat: defaultFormat as AppSettings['media'][MediaCategory]['defaultFormat']})}
              onQualityChange={(format, quality) => setFormatQuality(activeTab, format, quality)}
            />
          )}
        </section>

        <div className="mt-6 flex items-center gap-2 text-xs text-zinc-500" role="status" aria-live="polite">
          <FontAwesomeIcon icon={faCheck} className="text-emerald-400" />
          {t('settingsSavedAutomatically')}
        </div>
      </div>
    </div>
  );
}

type GeneralSettingsProps = {
  settings: AppSettings;
  autostartAvailable: boolean;
  autostartBusy: boolean;
  autostartError: string;
  onLanguageChange: (language: string) => void;
  onThemeChange: (theme: ThemePreference) => void;
  onAutoRenameOutputsChange: (enabled: boolean) => void;
  onAutostartChange: (enabled: boolean) => void;
};

function GeneralSettings({settings, autostartAvailable, autostartBusy, autostartError, onLanguageChange, onThemeChange, onAutoRenameOutputsChange, onAutostartChange}: Readonly<GeneralSettingsProps>) {
  const {t} = useTranslation();
  const languageOptions = Object.entries(languageNames).sort(([codeA, nameA], [codeB, nameB]) => {
    if (codeA === 'en') return -1;
    if (codeB === 'en') return 1;
    return nameA.localeCompare(nameB);
  });

  return (
    <div className="space-y-4">
      <div className="mb-5">
        <h2 className="text-lg font-semibold">{t('settingsTabGeneral')}</h2>
        <p className="mt-1 text-sm text-zinc-400">{t('settingsGeneralDescription')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className={cardClass}>
          <div className="mb-3 flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-zinc-800 text-violet-300"><FontAwesomeIcon icon={faLanguage} /></span>
            <div><h3 className="text-sm font-semibold">{t('language')}</h3><p className="text-xs text-zinc-500">{t('settingsLanguageDescription')}</p></div>
          </div>
          <select value={settings.general.language} onChange={(event) => onLanguageChange(event.target.value)} className={selectClass} aria-label={t('language')}>
            {languageOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </section>

        <section className={cardClass}>
          <div className="mb-3 flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-zinc-800 text-violet-300"><FontAwesomeIcon icon={faMoon} /></span>
            <div><h3 className="text-sm font-semibold">{t('settingsTheme')}</h3><p className="text-xs text-zinc-500">{t('settingsThemeDescription')}</p></div>
          </div>
          <select value={settings.general.theme} onChange={(event) => onThemeChange(event.target.value as ThemePreference)} className={selectClass} aria-label={t('settingsTheme')}>
            <option value="system">{t('themeSystem')}</option>
            <option value="light">{t('themeLight')}</option>
            <option value="dark">{t('themeDark')}</option>
          </select>
        </section>

        <section className={`${cardClass} md:col-span-2`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold">{t('settingsAutoRenameOutputs')}</h3>
              <p className="mt-1 text-xs text-zinc-500">{t('settingsAutoRenameOutputsDescription')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.general.autoRenameOutputs}
              aria-label={t('settingsAutoRenameOutputs')}
              onClick={() => onAutoRenameOutputsChange(!settings.general.autoRenameOutputs)}
              className={`relative h-7 w-12 rounded-full transition ${settings.general.autoRenameOutputs ? 'bg-violet-600' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${settings.general.autoRenameOutputs ? 'left-6' : 'left-1'}`} />
            </button>
          </div>
        </section>

        <section className={`${cardClass} md:col-span-2`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-zinc-800 text-violet-300"><FontAwesomeIcon icon={faRocket} /></span>
              <div><h3 className="text-sm font-semibold">{t('settingsLaunchAtStartup')}</h3><p className="mt-1 text-xs text-zinc-500">{t('settingsLaunchAtStartupDescription')}</p></div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.general.launchAtStartup}
              aria-label={t('settingsLaunchAtStartup')}
              disabled={!autostartAvailable || autostartBusy}
              onClick={() => onAutostartChange(!settings.general.launchAtStartup)}
              className={`relative h-7 w-12 rounded-full transition ${settings.general.launchAtStartup ? 'bg-violet-600' : 'bg-zinc-700'} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${settings.general.launchAtStartup ? 'left-6' : 'left-1'}`} />
            </button>
          </div>
          {!autostartAvailable && <p className="mt-3 text-xs text-amber-300">{t('settingsDesktopOnly')}</p>}
          {autostartError && <p className="mt-3 text-xs text-red-400">{t('settingsAutostartError', {error: autostartError})}</p>}
        </section>
      </div>
    </div>
  );
}

type MediaSettingsProps = {
  category: MediaCategory;
  settings: AppSettings;
  title: string;
  description: string;
  onDefaultFormatChange: (format: string) => void;
  onQualityChange: (format: string, quality: number) => void;
};

function MediaSettings({category, settings, title, description, onDefaultFormatChange, onQualityChange}: Readonly<MediaSettingsProps>) {
  const {t} = useTranslation();
  const categorySettings = settings.media[category];
  const formats = MEDIA_FORMATS[category];

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-zinc-400">{description}</p>
      </div>

      <section className={`${cardClass} mb-4`}>
        <label htmlFor="default-format" className="block text-sm font-semibold">{t('settingsDefaultOutputFormat')}</label>
        <p className="mt-1 text-xs text-zinc-500">{t('settingsDefaultOutputFormatDescription', {category: title.toLowerCase()})}</p>
        <select id="default-format" value={categorySettings.defaultFormat} onChange={(event) => onDefaultFormatChange(event.target.value)} className={`${selectClass} max-w-sm`}>
          {formats.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}
        </select>
      </section>

      <section className={cardClass}>
        <div className="mb-4">
          <h3 className="text-sm font-semibold">{t('settingsQualityByFormat')}</h3>
          <p className="mt-1 text-xs text-zinc-500">{t('settingsQualityByFormatDescription')}</p>
        </div>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {formats.map((format) => {
            const quality = categorySettings.qualityByFormat[format] ?? 80;
            return (
              <label key={format} className="block min-w-0">
                <span className="mb-2 flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-zinc-200">{format.toUpperCase()}</span>
                  <span className="tabular-nums text-zinc-400">{quality}%</span>
                </span>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={quality}
                  aria-label={t('settingsQualityForFormat', {format: format.toUpperCase()})}
                  onChange={(event) => onQualityChange(format, Number(event.target.value))}
                  className="w-full accent-violet-500"
                />
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}
