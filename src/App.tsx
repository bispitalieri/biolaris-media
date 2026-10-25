import {useEffect} from 'react';
import {Route, Routes, Navigate, useLocation} from 'react-router-dom';
import {isTauri} from '@tauri-apps/api/core';
import {ConvertScreen} from './screens/ConvertScreen';
import {CompressScreen} from './screens/CompressScreen';
import {SettingsScreen} from './screens/SettingsScreen';
import Sidebar from "./components/Sidebar.tsx";
import {useTranslation} from 'react-i18next';
import {openSettingsWindow} from './lib/windows';

export default function App() {
  const {t} = useTranslation();
  const location = useLocation();
  const isSettingsWindow = new URLSearchParams(location.search).get('window') === 'settings';

  useEffect(() => {
    if (isSettingsWindow || isTauri()) return;

    const openSettingsOnShortcut = (event: KeyboardEvent) => {
      const isShortcut = (event.metaKey || event.ctrlKey)
        && event.key === ','
        && !event.altKey
        && !event.shiftKey;
      if (!isShortcut || event.defaultPrevented || event.isComposing) return;

      event.preventDefault();
      void openSettingsWindow();
    };

    window.addEventListener('keydown', openSettingsOnShortcut);
    return () => window.removeEventListener('keydown', openSettingsOnShortcut);
  }, [isSettingsWindow]);

  if (isSettingsWindow) {
    return <SettingsScreen />;
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-8 py-8">
          <Routes>
            <Route path="/" element={<Navigate to="/convert" replace/>}/>
            <Route path="/convert" element={<ConvertScreen/>}/>
            <Route path="/compress" element={<CompressScreen/>}/>
          </Routes>
          <p className="mt-8 text-center text-xs text-zinc-600">
            {t('privacyNote')}
          </p>
        </div>
      </main>
    </div>
  );
}
