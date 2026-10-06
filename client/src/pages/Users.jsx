import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Modal, Spinner, useToast } from '../components.jsx';
import { ROLE_LABEL } from '../format.js';

export default function Users() {
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState(null);
  const { user: me } = useApp(); const toast = useToast();
  const load = useCallback(() => api('/users').then(setUsers).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => { load(); }, [load]);
  const remove = async (u) => {
    if (!window.confirm(`Supprimer le compte de ${u.nom} (${u.email}) ?`)) return;
    try { await api(`/users/${u.id}`, { method: 'DELETE' }); toast('Compte supprimé'); load(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Utilisateurs</h1><p className="muted">Qui peut consulter, saisir ou administrer.</p></div>
        <button className="btn primary" onClick={() => setForm({ role: 'saisie', actif: true })}><Plus size={18} />Ajouter un utilisateur</button>
      </div>
      <section className="card">
        <div className="roles-help">
          <div><b>Administrateur</b>Tout : camions, paramètres, utilisateurs, sauvegardes, saisies, imports.</div>
          <div><b>Saisie</b>Saisit les montants et importe des fichiers Excel. Ne modifie ni les camions, ni les paramètres, ni les comptes.</div>
          <div><b>Lecture seule</b>Consulte le tableau de bord, les fiches et les exports. Ne peut rien modifier.</div>
        </div>
      </section>
      <section className="card">
        {!users ? <div className="center"><Spinner /></div> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Statut</th><th /></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.nom}</b>{u.id === me.id && <span className="sub"> (vous)</span>}</td>
                    <td>{u.email}</td>
                    <td><span className={`role-pill ${u.role}`}>{ROLE_LABEL[u.role]}</span></td>
                    <td>{u.actif ? <span className="pill pos">Actif</span> : <span className="pill warn">Désactivé</span>}</td>
                    <td className="r">
                      <button className="icon-btn" title="Modifier" aria-label="Modifier" onClick={() => setForm(u)}><Pencil size={17} /></button>
                      {u.id !== me.id && <button className="icon-btn danger" title="Supprimer" aria-label="Supprimer" onClick={() => remove(u)}><Trash2 size={17} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {form && <UserForm u={form} isMe={form.id === me.id} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
}

function UserForm({ u, isMe, onClose, onSaved }) {
  const edit = !!u.id;
  const [f, setF] = useState({ email: u.email || '', nom: u.nom || '', role: u.role, actif: u.actif !== false, password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const toast = useToast();
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const body = { nom: f.nom, role: f.role, actif: f.actif, ...(edit ? {} : { email: f.email }), ...(f.password ? { password: f.password } : {}) };
    try { await api(edit ? `/users/${u.id}` : '/users', { method: edit ? 'PUT' : 'POST', body }); toast(edit ? 'Compte modifié' : 'Compte créé'); onSaved(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={edit ? `Modifier ${u.nom}` : 'Nouvel utilisateur'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Nom</span><input required value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} autoFocus /></label>
        <label className="field"><span>Email (identifiant de connexion)</span><input type="email" required disabled={edit} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="field"><span>Rôle</span>
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="saisie">Saisie</option><option value="lecture">Lecture seule</option><option value="admin">Administrateur</option>
          </select>
        </label>
        <label className="field"><span>{edit ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe (8 caractères minimum)'}</span>
          <input type="password" autoComplete="new-password" minLength={8} required={!edit} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        {edit && !isMe && <label className="check"><input type="checkbox" checked={f.actif} onChange={(e) => setF({ ...f, actif: e.target.checked })} />Compte actif (décochez pour bloquer la connexion)</label>}
        {err && <div className="form-error" role="alert">{err}</div>}
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
      </form>
    </Modal>
  );
}
