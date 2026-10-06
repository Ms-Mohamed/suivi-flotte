import React, { useState } from 'react';
import { Truck, LogIn } from 'lucide-react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const { token, user } = await api('/auth/login', { method: 'POST', body: { email, password } }); await onLogin(token, user); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <div className="login-hero">
        <span className="logo big"><Truck size={30} /></span>
        <h1>Suivez la rentabilité<br />de chaque camion.</h1>
        <p>Produits, charges variables, charges fixes, amortissements : le compte de résultat mensuel de chaque camion, calculé automatiquement.</p>
        <ul>
          <li>Résultat brut et net par camion et pour toute la flotte</li>
          <li>Coût au km, marge, consommation</li>
          <li>Export Excel prêt pour la comptabilité</li>
        </ul>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h2>Connexion</h2>
        <p className="muted">Accédez à votre espace de gestion.</p>
        <label className="field"><span>Email</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        <label className="field"><span>Mot de passe</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn primary block" disabled={busy}><LogIn size={18} />{busy ? 'Connexion…' : 'Se connecter'}</button>
      </form>
    </div>
  );
}
