import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { MoedaProvider } from './lib/moeda';
import { CreditosProvider } from './lib/creditos';
import { TemaProvider } from './lib/theme';
import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TemaProvider>
      <BrowserRouter>
        <AuthProvider>
          <MoedaProvider>
            <CreditosProvider>
              <App />
            </CreditosProvider>
          </MoedaProvider>
        </AuthProvider>
      </BrowserRouter>
    </TemaProvider>
  </StrictMode>,
);
