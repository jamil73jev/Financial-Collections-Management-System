import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Contribuyentes from './pages/Contribuyentes';
import Gestiones from './pages/Gestiones';
import Convenios from './pages/Convenios';
import Morosidad from './pages/Morosidad';
import Auditoria from './pages/Auditoria';
import Mapa from './pages/Mapa';
import Notificaciones from './pages/Notificaciones';
import Campanas from './pages/Campanas';
import CentroDatos from './pages/CentroDatos';
import Usuarios from './pages/Usuarios';
import Perfil from './pages/Perfil';

import { ToastProvider } from './context/ToastContext';

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Router>
          <Routes>
          <Route path="/login" element={<Login />} />
          
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/contribuyentes" element={<Contribuyentes />} />
            <Route path="/gestiones" element={<Gestiones />} />
            <Route path="/convenios" element={<Convenios />} />
            <Route path="/morosidad" element={<Morosidad />} />
            <Route path="/auditoria" element={<Auditoria />} />
            <Route path="/mapa" element={<Mapa />} />
            <Route path="/notificaciones" element={<Notificaciones />} />
            <Route path="/campanas" element={<Campanas />} />
            <Route path="/centro-datos" element={<CentroDatos />} />
            <Route path="/usuarios" element={<Usuarios />} />
            <Route path="/perfil" element={<Perfil />} />
            {/* Redirección por defecto */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Router>
    </ToastProvider>
  </AuthProvider>
);
}

export default App;
