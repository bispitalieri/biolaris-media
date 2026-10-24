import {Route, Routes, Navigate} from 'react-router-dom';
import {ConvertScreen} from './screens/ConvertScreen';
import {CompressScreen} from './screens/CompressScreen';
import Sidebar from "./components/Sidebar.tsx";
import {useTranslation} from 'react-i18next';

export default function App() {
  const {t} = useTranslation();

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
