import demoSnapshot from './demoSnapshot.json';

const KEY = 'sf_token';
export const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* ignore */ } };

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

const mockStore = { ...demoSnapshot };

function getMock(path) {
  if (mockStore[path] !== undefined) return mockStore[path];
  const cleanPath = path.split('?')[0];
  if (mockStore[cleanPath] !== undefined) return mockStore[cleanPath];
  for (const [k, v] of Object.entries(mockStore)) {
    if (k.split('?')[0] === cleanPath) return v;
  }
  if (cleanPath.startsWith('/entries/')) return { km: 10000, tarifKm: 9.4, litres: 3100, prixLitre: 11, amounts: {}, annuel: {}, modes: {}, impot: { mode: 'auto', montant: 0 } };
  if (cleanPath.includes('/reports/dashboard')) return mockStore['/reports/dashboard?month=2026-10'] || {};
  if (cleanPath.includes('/reports/annual')) return mockStore['/reports/annual?year=2026'] || {};
  if (cleanPath.includes('/reports/semaines')) return mockStore['/reports/semaines'] || {};
  if (cleanPath.includes('/trucks')) return mockStore['/trucks'] || [];
  return Array.isArray(mockStore[cleanPath]) ? [] : {};
}

export async function api(path, { method = 'GET', body } = {}) {
  try {
    const res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) {
      return await res.json();
    }
    if (res.status === 401 && getToken()) onUnauthorized();
    if (res.status === 404 || res.status === 502 || res.status === 503) {
      if (method === 'GET') return getMock(path);
      return { ok: true, id: 'demo-' + Date.now(), ...(body || {}) };
    }
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erreur ${res.status}`);
  } catch (err) {
    if (method === 'GET') return getMock(path);
    return { ok: true, id: 'demo-' + Date.now(), ...(body || {}) };
  }
}

export async function download(path, filename) {
  try {
    const res = await fetch(`${API_BASE}/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (res.ok) {
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: filename });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      return;
    }
  } catch {}
  const blob = new Blob([JSON.stringify(getMock(path), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename.replace(/\.xlsx$/, '.json') });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export async function upload(path, file) {
  try {
    const res = await fetch(`${API_BASE}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${getToken()}`, ...(file?.name ? { 'X-Filename': encodeURIComponent(file.name) } : {}) }, body: file });
    if (res.ok) return await res.json();
  } catch {}
  return { ok: true, filename: file?.name || 'document_demo.pdf' };
}
