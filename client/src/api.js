const KEY = 'sf_token';
export const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* ignore */ } };

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
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
  const res = await fetch(`${API_BASE}/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error('Export impossible');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export async function upload(path, file) {
  const res = await fetch(`${API_BASE}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${getToken()}`, ...(file?.name ? { 'X-Filename': encodeURIComponent(file.name) } : {}) }, body: file });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && getToken()) onUnauthorized();
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}
