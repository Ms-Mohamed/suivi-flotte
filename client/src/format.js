import { IS_EN, LOCALE, NUM_LOCALE, DEC } from './i18n/lang.js';
const f0 = new Intl.NumberFormat(NUM_LOCALE, { maximumFractionDigits: 0 });
const f2 = new Intl.NumberFormat(NUM_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const n0 = (v) => f0.format(Math.round(v || 0));
export const n2 = (v) => f2.format(v || 0);
export { DEC };
export const dhs = (v, dec = 0) => `${dec ? n2(v) : n0(v)} DHS`;
export const compact = (v) => {
  const a = Math.abs(v || 0);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', DEC)} M`;
  if (a >= 1e3) return `${n0(v / 1e3)} k`;
  return n0(v);
};
export const monthLong = (m) => { const [y, mo] = m.split('-').map(Number); const s = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' }); return s.charAt(0).toUpperCase() + s.slice(1); };
export const monthShort = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(LOCALE, { month: 'short', timeZone: 'UTC' }).replace('.', ''); };
export const tone = (v) => (v < 0 ? 'neg' : v > 0 ? 'pos' : '');
export const parseNum = (s) => { const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
export const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', DEC)} ${IS_EN ? 'MB' : 'Mo'}` : `${Math.max(1, Math.round(b / 1024))} ${IS_EN ? 'KB' : 'Ko'}`);
export const fmtDateTime = (iso) => new Date(iso).toLocaleString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const ROLE_LABEL = IS_EN ? { admin: 'Administrator', saisie: 'Data entry', lecture: 'Read-only' } : { admin: 'Administrateur', saisie: 'Saisie', lecture: 'Lecture seule' };

export const fmtDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
export const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const addDaysStr = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/* ---------- Montant en lettres (factures marocaines) ---------- */
const U = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const T = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
function sous100(n, final) {
  if (n < 17) return U[n];
  if (n < 20) return `dix-${U[n - 10]}`;
  if (n < 70) { const d = Math.floor(n / 10), u = n % 10; return u === 0 ? T[d] : u === 1 ? `${T[d]} et un` : `${T[d]}-${U[u]}`; }
  if (n < 80) { const u = n - 60; return u === 11 ? 'soixante et onze' : `soixante-${sous100(u, false)}`; }
  if (n === 80) return final ? 'quatre-vingts' : 'quatre-vingt';
  return `quatre-vingt-${sous100(n - 80, false)}`;
}
function sous1000(n, final) {
  if (n < 100) return sous100(n, final);
  const c = Math.floor(n / 100), r = n % 100;
  const cent = c === 1 ? 'cent' : `${U[c]} cent${r === 0 && final ? 's' : ''}`;
  return r === 0 ? cent : `${cent} ${sous100(r, final)}`;
}

const UE = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TE = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function under1000En(n) {
  const parts = [];
  if (n >= 100) { parts.push(`${UE[Math.floor(n / 100)]} hundred`); n %= 100; if (n) parts.push('and'); }
  if (n >= 20) { const u = n % 10; parts.push(u ? `${TE[Math.floor(n / 10)]}-${UE[u]}` : TE[Math.floor(n / 10)]); } else if (n > 0) parts.push(UE[n]);
  return parts.join(' ');
}
function nombreEnLettresEn(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'zero';
  const parts = [];
  for (const [v, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) { if (n >= v) { parts.push(`${under1000En(Math.floor(n / v))} ${name}`); n %= v; } }
  if (n > 0) parts.push(n < 100 && parts.length ? `and ${under1000En(n)}` : under1000En(n));
  return parts.join(' ');
}
export function nombreEnLettres(n) {
  if (IS_EN) return nombreEnLettresEn(n);
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'zéro';
  const parts = []; const scales = [[1e9, 'milliard'], [1e6, 'million']];
  for (const [v, name] of scales) { if (n >= v) { const q = Math.floor(n / v); parts.push(`${sous1000(q, false)} ${name}${q > 1 ? 's' : ''}`); n %= v; } }
  if (n >= 1000) { const q = Math.floor(n / 1000); parts.push(q === 1 ? 'mille' : `${sous1000(q, false)} mille`); n %= 1000; }
  if (n > 0) parts.push(sous1000(n, true));
  return parts.join(' ');
}
export function montantEnLettres(v) {
  if (IS_EN) { const a = Math.round(Math.abs(v || 0) * 100); const e = Math.floor(a / 100), c = a % 100; const s = `${nombreEnLettresEn(e)} dirham${e === 1 ? '' : 's'}${c ? ` and ${nombreEnLettresEn(c)} cent${c === 1 ? '' : 's'}` : ''}`; return s.charAt(0).toUpperCase() + s.slice(1); }
  const abs = Math.round(Math.abs(v || 0) * 100); const ent = Math.floor(abs / 100), cts = abs % 100;
  const de = ent >= 1e6 && ent % 1e6 === 0 ? ' de' : '';
  const s = `${nombreEnLettres(ent)}${de} dirham${ent > 1 ? 's' : ''}${cts ? ` et ${nombreEnLettres(cts)} centime${cts > 1 ? 's' : ''}` : ''}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
