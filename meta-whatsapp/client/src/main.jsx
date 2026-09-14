import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { WaProvider } from './store';
import './styles/app.css';
import './styles/inbox.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WaProvider>
      <App />
    </WaProvider>
  </React.StrictMode>
);
