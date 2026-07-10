import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { SimuladorPage } from './pages/Simulador';
import { OrcamentosPage } from './pages/Orcamentos';
import { MateriaisPage } from './pages/Materiais';
import { ImpressorasPage } from './pages/Impressoras';
import { CustosFixosPage } from './pages/CustosFixos';
import { CustosVariaveisPage } from './pages/CustosVariaveis';
import { ConfiguracaoPage } from './pages/Configuracao';
import { MoedasPage } from './pages/Moedas';

/** Bloqueia rotas quando nao autenticado. */
function Protegido({ children }: { children: JSX.Element }) {
  const { autenticado } = useAuth();
  return autenticado ? children : <Navigate to="/login" replace />;
}

export function App() {
  const { autenticado } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={autenticado ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        element={
          <Protegido>
            <Layout />
          </Protegido>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/simulador" element={<SimuladorPage />} />
        <Route path="/orcamentos" element={<OrcamentosPage />} />
        <Route path="/materiais" element={<MateriaisPage />} />
        <Route path="/impressoras" element={<ImpressorasPage />} />
        <Route path="/custos-fixos" element={<CustosFixosPage />} />
        <Route path="/custos-variaveis" element={<CustosVariaveisPage />} />
        <Route path="/moedas" element={<MoedasPage />} />
        <Route path="/configuracao" element={<ConfiguracaoPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
