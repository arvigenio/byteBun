import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css'; // also loads the self-hosted Plus Jakarta Sans font
import { Provider } from 'react-redux';
import App from './App.jsx';
import { store } from './store/index.js';
import { captureAttribution } from './lib/attribution.js';
import { loadGtm } from './lib/gtm.js';

captureAttribution(); // where the visitor came from, sent with a booking
loadGtm();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
);
