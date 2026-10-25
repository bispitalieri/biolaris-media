import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import App from './App';
import {SettingsProvider} from './lib/settings';
import './styles.css';
import './lib/i18n';

createRoot(document.getElementById('root')!)
  .render(
    <React.StrictMode>
      <BrowserRouter>
        <SettingsProvider>
          <App/>
        </SettingsProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
