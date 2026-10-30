import React, { useEffect, useState, createContext, useContext } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Truck, FileBarChart2, Settings as Cog, LogOut, Menu, X, FileUp, Users as UsersIcon, ClipboardList, CalendarDays, ScrollText, Fuel, Wrench, Route as RouteIcon, CalendarRange, Gauge, Building2, Briefcase, FileText, Receipt, Wallet, Landmark, HandCoins, Package, ShoppingCart, Boxes, TriangleAlert, FileMinus, CreditCard, ChartColumn, UserCheck, Clock, Banknote, Handshake, Contact, ClipboardCheck, FolderOpen, Siren, ArrowLeftRight, Calculator, PiggyBank, TrendingUp, ChevronDown, ChevronRight, FileSpreadsheet, Hammer, PackageSearch, CalendarClock, Coins, Scale, Container } from 'lucide-react';
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
import Rapport from './pages/Rapport.jsx';
import Carburant from './pages/Carburant.jsx';
import Maintenance from './pages/Maintenance.jsx';
import TruckHistory from './pages/TruckHistory.jsx';
import * as Com from './pages/Commercial.jsx';
import * as ST from './pages/SousTraitance.jsx';
import * as ACH from './pages/Achats.jsx';
import * as RH from './pages/RH.jsx';
import * as FL from './pages/FleetExtra.jsx';
import { ROLE_LABEL } from './format.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export const DEMO_USER = { id: 'demo', email: 'demo@flotte.local', nom: 'Visiteur (Démo)', role: 'admin', actif: true };

export default function App() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [ready, setReady] = useState(false);
  const nav = useNavigate();

  const logout = () => { setToken(null); setUser(null); nav('/connexion'); };
  useEffect(() => { setUnauthorizedHandler(logout); }); // eslint-disable-line
  useEffect(() => {
    (async () => {
      try {
        let u = null;
        if (getToken()) {
          try {
            const res = await api('/auth/me');
            u = res.user;
          } catch {
            setToken(null);
          }
        }
        // Mode démo par défaut : accès direct sans mot de passe
        if (!u) {
          u = DEMO_USER;
        }
        setUser(u);
        const s = await api('/settings').catch(() => null);
        setSettings(s);
      } catch {
        setUser(DEMO_USER);
      } finally {
        setReady(true);
      }
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
  const GROUPS = [
    { title: null, links: [{ to: '/', label: 'Tableau de bord', icon: LayoutDashboard, end: true }] },
    { id: 'expl', title: 'Exploitation', links: [
      { to: '/camions', label: 'Camions', icon: Truck }, { to: '/missions', label: 'Missions', icon: RouteIcon }, { to: '/locations', label: 'Locations', icon: Container }, { to: '/calendrier', label: 'Calendrier', icon: CalendarRange },
      { to: '/disponibilite', label: 'Disponibilité', icon: Gauge }, { to: '/operations', label: 'Opérations', icon: ClipboardList }, { to: '/semaines', label: 'Semaines', icon: CalendarDays }, { to: '/rapport-heures', label: 'Rapport des heures', icon: Clock } ] },
    { id: 'com', title: 'Facturation', links: [
      { to: '/clients', label: 'Clients', icon: Contact }, { to: '/devis', label: 'Devis', icon: FileText }, { to: '/bons-livraison', label: 'Bons de livraison', icon: ClipboardCheck }, { to: '/factures', label: 'Factures', icon: Receipt },
      { to: '/avoirs', label: 'Avoirs', icon: FileMinus }, { to: '/paiements', label: 'Paiements clients', icon: CreditCard }, { to: '/releve-reglements', label: 'Relevé règlements', icon: FileSpreadsheet }, { to: '/releve-missions', label: 'Relevé missions client', icon: ScrollText },
      { to: '/caisse', label: 'Caisse', icon: Banknote }, { to: '/depenses', label: 'Dépenses', icon: Coins }, { to: '/rentabilite', label: 'Rentabilité', icon: TrendingUp } ] },
    { id: 'st', title: 'Sous-traitance', links: [
      { to: '/st/operations', label: 'Opérations', icon: Handshake }, { to: '/st/sous-traitants', label: 'Sous-traitants', icon: Building2 }, { to: '/st/vehicules', label: 'Véhicules', icon: Truck }, { to: '/st/tonnage', label: 'Rapport tonnage', icon: Scale }, { to: '/st/paiements', label: 'Suivi paiements', icon: HandCoins } ] },
    { id: 'ach', title: 'Achats', links: [
      { to: '/achats/fournisseurs', label: 'Fournisseurs', icon: Building2 }, { to: '/achats/articles', label: 'Articles & services', icon: Package }, { to: '/achats', label: 'Achats', icon: ShoppingCart, end: true }, { to: '/achats/paiements', label: 'Suivi paiements', icon: Wallet }, { to: '/achats/releve', label: 'Relevé achats', icon: FileSpreadsheet } ] },
    { id: 'rh', title: 'RH & paie', roles: ['admin'], links: [
      { to: '/rh/employes', label: 'Employés', icon: UsersIcon }, { to: '/rh/pointage', label: 'Pointage', icon: UserCheck }, { to: '/rh/avances', label: 'Avances', icon: PiggyBank }, { to: '/rh/primes', label: 'Primes & retenues', icon: Coins },
      { to: '/rh/paie', label: 'Paie', icon: Calculator }, { to: '/rh/contrats', label: 'Contrats', icon: Briefcase }, { to: '/rh/alertes', label: 'Alertes RH', icon: TriangleAlert } ] },
    { id: 'flt', title: 'Flotte & maintenance', links: [
      { to: '/gasoil', label: 'Gasoil', icon: Fuel }, { to: '/maintenance', label: 'Maintenance', icon: Wrench }, { to: '/documents', label: 'Documents véhicules', icon: FolderOpen }, { to: '/alertes-vehicules', label: 'Alertes véhicules', icon: Siren },
      { to: '/pannes', label: 'Pannes', icon: Hammer }, { to: '/pieces', label: 'Pièces & stock', icon: Boxes }, { to: '/mouvements-pieces', label: 'Mouvements de stock', icon: ArrowLeftRight } ] },
    { id: 'ana', title: 'Analyse', links: [{ to: '/rapports', label: 'Rapport annuel', icon: FileBarChart2 }, { to: '/rapport', label: 'Rapport global', icon: ScrollText }] },
    { id: 'adm', title: 'Administration', links: [
      { to: '/import', label: 'Import Excel', icon: FileUp, roles: ['admin', 'saisie'] }, { to: '/utilisateurs', label: 'Utilisateurs', icon: UsersIcon, roles: ['admin'] }, { to: '/parametres', label: 'Paramètres', icon: Cog, roles: ['admin'] } ] },
  ].filter((g) => !g.roles || g.roles.includes(user.role)).map((g) => ({ ...g, links: g.links.filter((l) => !l.roles || l.roles.includes(user.role)) })).filter((g) => g.links.length);
  const isOn = (l) => (l.end ? loc.pathname === l.to : loc.pathname === l.to || loc.pathname.startsWith(`${l.to}/`)) || (l.to === '/camions' && loc.pathname.startsWith('/camion/'));
  const activeGroup = GROUPS.find((g) => g.links.some(isOn))?.id;
  const [openG, setOpenG] = useState(() => { try { return JSON.parse(localStorage.getItem('sf_nav') || '[]'); } catch { return []; } });
  useEffect(() => { if (activeGroup) setOpenG((o) => (o.includes(activeGroup) ? o : [...o, activeGroup])); }, [activeGroup]);
  const toggleG = (id) => setOpenG((o) => { const n = o.includes(id) ? o.filter((x) => x !== id) : [...o, id]; try { localStorage.setItem('sf_nav', JSON.stringify(n)); } catch { /* ignore */ } return n; });
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
          {GROUPS.map((g) => (
            <div className="navgroup" key={g.id || 'top'}>
              {g.title && <button className="navgroup-title" onClick={() => toggleG(g.id)} aria-expanded={openG.includes(g.id)}>{g.title}{openG.includes(g.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>}
              {(!g.title || openG.includes(g.id)) && g.links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className={() => `navlink ${g.title ? 'sub' : ''} ${isOn(l) ? 'active' : ''}`}>
                  <l.icon size={g.title ? 17 : 19} />{l.label}
                </NavLink>
              ))}
            </div>
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
          <Route path="gasoil" element={<Carburant />} />
          <Route path="maintenance" element={<Maintenance />} />
          <Route path="missions" element={<Com.Missions />} />
          <Route path="clients" element={<Com.Clients />} />
          <Route path="devis" element={<Com.Devis />} />
          <Route path="bons-livraison" element={<Com.BonsLivraison />} />
          <Route path="factures" element={<Com.Factures />} />
          <Route path="avoirs" element={<Com.Avoirs />} />
          <Route path="paiements" element={<Com.Paiements />} />
          <Route path="releve-reglements" element={<Com.ReleveReglements />} />
          <Route path="releve-missions" element={<Com.ReleveMissions />} />
          <Route path="caisse" element={<Com.Caisse />} />
          <Route path="depenses" element={<Com.Depenses />} />
          <Route path="rentabilite" element={<Com.Rentabilite />} />
          <Route path="st/operations" element={<ST.OperationsST />} />
          <Route path="st/sous-traitants" element={<ST.SousTraitants />} />
          <Route path="st/vehicules" element={<ST.VehiculesST />} />
          <Route path="st/tonnage" element={<ST.RapportTonnage />} />
          <Route path="st/paiements" element={<ST.SuiviPaiementsST />} />
          <Route path="achats" element={<ACH.Achats />} />
          <Route path="achats/fournisseurs" element={<ACH.Fournisseurs />} />
          <Route path="achats/articles" element={<ACH.Articles />} />
          <Route path="achats/paiements" element={<ACH.SuiviPaiementsAchats />} />
          <Route path="achats/releve" element={<ACH.ReleveAchats />} />
          {['employes:Employes', 'pointage:Pointage', 'avances:Avances', 'primes:Primes', 'paie:Paie', 'contrats:Contrats', 'alertes:AlertesRH'].map((x) => { const [path, name] = x.split(':'); const C = RH[name]; return <Route key={path} path={`rh/${path}`} element={user.role === 'admin' ? <C /> : <Navigate to="/" replace />} />; })}
          <Route path="documents" element={<FL.DocumentsVehicules />} />
          <Route path="alertes-vehicules" element={<FL.AlertesVehicules />} />
          <Route path="disponibilite" element={<FL.Disponibilite />} />
          <Route path="calendrier" element={<FL.Calendrier />} />
          <Route path="locations" element={<FL.Locations />} />
          <Route path="rapport-heures" element={<FL.RapportHeures />} />
          <Route path="pannes" element={<FL.Pannes />} />
          <Route path="pieces" element={<FL.Pieces />} />
          <Route path="mouvements-pieces" element={<FL.MouvementsPieces />} />
          <Route path="rapports" element={<Reports />} />
          <Route path="rapport" element={<Rapport />} />
          <Route path="import" element={user.role === 'lecture' ? <Navigate to="/" replace /> : <ImportPage />} />
          <Route path="utilisateurs" element={user.role === 'admin' ? <Users /> : <Navigate to="/" replace />} />
          <Route path="parametres" element={user.role === 'admin' ? <Settings /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
