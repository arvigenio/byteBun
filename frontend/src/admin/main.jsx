import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css'; // brand tokens and the self-hosted font
import { Provider } from 'react-redux';
import { adminStore } from '../store/adminStore.js';
import AdminApp from './AdminApp.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={adminStore}>
      <AdminApp />
    </Provider>
  </StrictMode>,
);
