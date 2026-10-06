const f0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const f2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const n0 = (v) => f0.format(Math.round(v || 0));
export const n2 = (v) => f2.format(v || 0);
export const dhs = (v, dec = 0) => `${dec ? n2(v) : n0(v)} DHS`;
export const compact = (v) => {
  const a = Math.abs(v || 0);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')} M`;
  if (a >= 1e3) return `${n0(v / 1e3)} k`;
  return n0(v);
};
export const monthLong = (m) => { const [y, mo] = m.split('-').map(Number); const s = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }); return s.charAt(0).toUpperCase() + s.slice(1); };
export const monthShort = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' }).replace('.', ''); };
export const tone = (v) => (v < 0 ? 'neg' : v > 0 ? 'pos' : '');
export const parseNum = (s) => { const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
export const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`);
export const fmtDateTime = (iso) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const ROLE_LABEL = { admin: 'Administrateur', saisie: 'Saisie', lecture: 'Lecture seule' };
