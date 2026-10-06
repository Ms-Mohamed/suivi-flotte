import React, { useEffect, useState, createContext, useContext } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Truck, FileBarChart2, Settings as Cog, LogOut, Menu, X, FileUp, Users as UsersIcon, ClipboardList, CalendarDays } from 'lucide-react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';
import { ToastProvider, Spinner } from './components.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Trucks from './pages/Trucks.jsx';
import Statement from './pages/Statement.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Users from './pages/Users.jsx';
import ImportPage from './pages/Import.jsx';
import Operations from './pages/Operations.jsx';
import Weeks from './pages/Weeks.jsx';
import TruckHistory from './pages/TruckHistory.jsx';
import { ROLE_LABEL } from './format.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export default function App() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [ready, setReady] = useState(false);
  const nav = useNavigate();

  const logout = () => { setToken(null); setUser(null); nav('/connexion'); };
  useEffect(() => { setUnauthorizedHandler(logout); }); // eslint-disable-line
  useEffect(() => {
    (async () => {
      if (getToken()) {
        try { const [{ user }, s] = await Promise.all([api('/auth/me'), api('/settings')]); setUser(user); setSettings(s); } catch { setToken(null); }
      }
      setReady(true);
    })();
  }, []);

  if (!ready) return <div className="boot"><Spinner /></div>;
  const login = async (token, u) => { setToken(token); setUser(u); setSettings(await api('/settings')); nav('/'); };

  return (
    <ToastProvider>
      <AppCtx.Provider value={{ user, settings, setSettings, logout }}>
        <Routes>
          <Route path="/connexion" element={user ? <Navigate to="/" replace /> : <Login onLogin={login} />} />
          <Route path="/*" element={user ? <Shell /> : <Navigate to="/connexion" replace />} />
        </Routes>
      </AppCtx.Provider>
    </ToastProvider>
  );
}

function Shell() {
  const { user, settings, logout } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const links = [
    { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, end: true },
    { to: '/camions', label: 'Camions', icon: Truck },
    { to: '/operations', label: 'Opérations', icon: ClipboardList },
    { to: '/semaines', label: 'Semaines', icon: CalendarDays },
    { to: '/rapports', label: 'Rapport annuel', icon: FileBarChart2 },
    { to: '/import', label: 'Import Excel', icon: FileUp, roles: ['admin', 'saisie'] },
    { to: '/utilisateurs', label: 'Utilisateurs', icon: UsersIcon, roles: ['admin'] },
    { to: '/parametres', label: 'Paramètres', icon: Cog, roles: ['admin'] },
  ].filter((l) => !l.roles || l.roles.includes(user.role));
  return (
    <div className="shell">
      <header className="mobilebar">
        <button className="icon-btn" onClick={() => setOpen(!open)} aria-label="Menu">{open ? <X size={20} /> : <Menu size={20} />}</button>
        <strong>Suivi Flotte</strong>
      </header>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="logo"><Truck size={20} /></span>
          <div><strong>Suivi Flotte</strong><small>{settings?.societe}</small></div>
        </div>
        <nav>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `navlink ${isActive || (l.to === '/camions' && loc.pathname.startsWith('/camion/')) ? 'active' : ''}`}>
              <l.icon size={19} />{l.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="me"><span className="avatar">{(user.nom || user.email)[0].toUpperCase()}</span><div><strong>{user.nom}</strong><small>{ROLE_LABEL[user.role]} · {user.email}</small></div></div>
          <button className="navlink" onClick={logout}><LogOut size={19} />Se déconnecter</button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="camions" element={<Trucks />} />
          <Route path="camion/:id" element={<TruckHistory />} />
          <Route path="camion/:id/:month" element={<Statement />} />
          <Route path="operations" element={<Operations />} />
          <Route path="semaines" element={<Weeks />} />
          <Route path="rapports" element={<Reports />} />
          <Route path="import" element={user.role === 'lecture' ? <Navigate to="/" replace /> : <ImportPage />} />
          <Route path="utilisateurs" element={user.role === 'admin' ? <Users /> : <Navigate to="/" replace />} />
          <Route path="parametres" element={user.role === 'admin' ? <Settings /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
