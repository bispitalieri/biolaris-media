import {NavLink, Route, Routes, Navigate} from 'react-router-dom';
import {ConvertScreen} from './screens/ConvertScreen';
import {CompressScreen} from './screens/CompressScreen';
import Sidebar from "./components/Sidebar.tsx";

export default function App() {
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
            I file vengono elaborati sul dispositivo. I formati disponibili dipendono dai codec inclusi nel pacchetto.
          </p>
        </div>
      </main>
    </div>
  );
}


