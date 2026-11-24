import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { Toaster } from 'sonner';
import './client.css';
import ClientApp from './ClientApp.jsx';
import { clientStore } from './store.js';
import { AskProvider } from './ui.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={clientStore}>
      <AskProvider>
        <ClientApp />
      </AskProvider>
      <Toaster position="top-center" richColors closeButton />
    </Provider>
  </StrictMode>,
);
