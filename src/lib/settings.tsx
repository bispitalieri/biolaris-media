import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode} from 'react';
import i18n from './i18n';
import type {FileType, OutputFormat} from './media';

export type ThemePreference = 'system' | 'light' | 'dark';
export type MediaCategory = 'images' | 'audio' | 'videos' | 'pdf';
export type AppSettings = {
  general: {
    language: string;
    theme: ThemePreference;
    launchAtStartup: boolean;
    autoRenameOutputs: boolean;
  };
  media: Record<MediaCategory, {
    defaultFormat: OutputFormat;
    qualityByFormat: Partial<Record<OutputFormat, number>>;
  }>;
};

export const STORAGE_KEY = 'biolaris-settings';

export const MEDIA_FORMATS: Record<MediaCategory, OutputFormat[]> = {
  images: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif', 'jxl', 'gif', 'bmp', 'tiff', 'tif', 'ico', 'tga', 'dds', 'hdr', 'exr', 'pcx', 'pbm', 'pgm', 'ppm', 'pnm'],
  audio: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'],
  videos: ['mp4', 'webm', 'mkv', 'avi', 'mov', 'gif'],
  pdf: ['jpg', 'png', 'webp'],
};

const initialSettings: AppSettings = {
  general: {
    language: 'en',
    theme: 'system',
    launchAtStartup: false,
    autoRenameOutputs: true,
  },
  media: {
    images: {
      defaultFormat: 'jpg',
      qualityByFormat: {jpg: 85, jpeg: 85, png: 90, webp: 85, avif: 80, heic: 85, heif: 85, jxl: 85, gif: 85, bmp: 90, tiff: 90, tif: 90, ico: 90, tga: 90, dds: 90, hdr: 90, exr: 90, pcx: 90, pbm: 90, pgm: 90, ppm: 90, pnm: 90},
    },
    audio: {
      defaultFormat: 'mp3',
      qualityByFormat: {mp3: 80, wav: 90, flac: 90, ogg: 80, m4a: 80, aac: 80, opus: 80},
    },
    videos: {
      defaultFormat: 'mp4',
      qualityByFormat: {mp4: 80, webm: 80, mkv: 80, avi: 75, mov: 80, gif: 70},
    },
    pdf: {
      defaultFormat: 'png',
      qualityByFormat: {jpg: 85, png: 90, webp: 85},
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validQualityMap(value: unknown, defaults: Partial<Record<OutputFormat, number>>) {
  if (!isRecord(value)) return defaults;
  const result = {...defaults};
  for (const [format, quality] of Object.entries(value)) {
    if (typeof quality === 'number' && Number.isFinite(quality)) {
      result[format as OutputFormat] = Math.max(1, Math.min(100, Math.round(quality)));
    }
  }
  return result;
}

export function loadAppSettings(): AppSettings {
  let saved: unknown;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    saved = raw ? JSON.parse(raw) : undefined;
  } catch {
    saved = undefined;
  }

  const source = isRecord(saved) ? saved : {};
  const general = isRecord(source.general) ? source.general : {};
  const media = isRecord(source.media) ? source.media : {};
  let legacyLanguage = 'en';
  try {
    legacyLanguage = window.localStorage.getItem('biolaris-language') ?? 'en';
  } catch {
    // Keep the built-in default when local storage is unavailable.
  }

  const next: AppSettings = {
    general: {
      language: typeof general.language === 'string' ? general.language : legacyLanguage,
      theme: general.theme === 'light' || general.theme === 'dark' || general.theme === 'system' ? general.theme : 'system',
      launchAtStartup: typeof general.launchAtStartup === 'boolean' ? general.launchAtStartup : false,
      autoRenameOutputs: typeof general.autoRenameOutputs === 'boolean' ? general.autoRenameOutputs : true,
    },
    media: {...initialSettings.media},
  };

  for (const category of Object.keys(initialSettings.media) as MediaCategory[]) {
    const current = isRecord(media[category]) ? media[category] : {};
    const defaults = initialSettings.media[category];
    const formats = MEDIA_FORMATS[category];
    const requestedFormat = current.defaultFormat;
    next.media[category] = {
      defaultFormat: typeof requestedFormat === 'string' && formats.includes(requestedFormat as OutputFormat)
        ? requestedFormat as OutputFormat
        : defaults.defaultFormat,
      qualityByFormat: validQualityMap(current.qualityByFormat, defaults.qualityByFormat),
    };
  }

  return next;
}

function resolveTheme(theme: ThemePreference): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyAppSettings(settings: AppSettings) {
  document.documentElement.dataset.theme = resolveTheme(settings.general.theme);
  if (i18n.resolvedLanguage !== settings.general.language) {
    void i18n.changeLanguage(settings.general.language);
  }
}

export function getConfiguredFormat(fileType: FileType): OutputFormat {
  const category: MediaCategory | undefined = fileType === 'raw' || fileType === 'image' ? 'images'
    : fileType === 'audio' ? 'audio'
      : fileType === 'video' ? 'videos'
        : fileType === 'pdf' ? 'pdf'
          : undefined;
  if (!category) return 'jpg';
  return loadAppSettings().media[category].defaultFormat;
}

export function getConfiguredQuality(fileType: FileType, format: OutputFormat): number {
  const category: MediaCategory | undefined = fileType === 'raw' || fileType === 'image' ? 'images'
    : fileType === 'audio' ? 'audio'
      : fileType === 'video' ? 'videos'
        : fileType === 'pdf' ? 'pdf'
          : undefined;
  if (!category) return 80;
  return loadAppSettings().media[category].qualityByFormat[format] ?? 80;
}

type SettingsContextValue = {
  settings: AppSettings;
  updateSettings: (update: (current: AppSettings) => AppSettings) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({children}: Readonly<{children: ReactNode}>) {
  const [settings, setSettings] = useState(loadAppSettings);

  useLayoutEffect(() => {
    applyAppSettings(settings);
  }, [settings]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setSettings(loadAppSettings());
    };
    window.addEventListener('storage', onStorage);

    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystemThemeChange = () => {
      const current = loadAppSettings();
      if (current.general.theme === 'system') applyAppSettings(current);
    };
    mediaQuery?.addEventListener('change', onSystemThemeChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      mediaQuery?.removeEventListener('change', onSystemThemeChange);
    };
  }, []);

  const updateSettings = useCallback((update: (current: AppSettings) => AppSettings) => {
    const next = update(loadAppSettings());
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Apply for this session if browser storage is unavailable.
    }
    setSettings(next);
  }, []);

  const value = useMemo(() => ({settings, updateSettings}), [settings, updateSettings]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useAppSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useAppSettings deve essere usato dentro SettingsProvider');
  return context;
}
