const KEY = 'sf_token';
export const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* ignore */ } };

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export const DEMO = import.meta.env.VITE_DEMO === '1';

// Mode démo (hébergement statique sans serveur) : les GET sont servis depuis un instantané enregistré
// sur le jeu de démonstration ; les écritures sont acceptées mais ne sont pas conservées.
let snapP;
const snapshot = () => (snapP ||= import('./demoSnapshot.json').then((m) => m.default));
async function demoGet(path) {
  const snap = await snapshot();
  if (path in snap) return snap[path];
  const base = path.split('?')[0];
  const hit = Object.keys(snap).find((k) => k.split('?')[0] === base);
  if (hit) return snap[hit];
  const stripped = base.replace(/\/[^/]+$/, '');   // /entity/:id -> liste
  const list = snap[stripped] ?? snap[Object.keys(snap).find((k) => k.split('?')[0] === stripped)];
  if (list && Array.isArray(list.items || list)) { const id = base.split('/').pop(); const f = (list.items || list).find((x) => String(x._id || x.id) === id); if (f) return f; }
  return {};
}

export async function api(path, { method = 'GET', body } = {}) {
  if (DEMO) {
    if (method === 'GET') return demoGet(path);
    if (path === '/auth/password') throw new Error('Désactivé en mode démo');
    return { ok: true, id: `demo-${Date.now()}`, ...(body || {}) };
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && getToken()) onUnauthorized();
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

export async function download(path, filename) {
  if (DEMO) throw new Error('Export indisponible en mode démo');
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error('Export impossible');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export async function upload(path, file) {
  if (DEMO) throw new Error('Envoi de fichier indisponible en mode démo');
  const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${getToken()}`, ...(file?.name ? { 'X-Filename': encodeURIComponent(file.name) } : {}) }, body: file });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && getToken()) onUnauthorized();
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}
