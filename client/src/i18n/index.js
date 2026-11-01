// Traduction FR → EN à l'exécution : dictionnaire exact + motifs, appliqués aux nœuds texte et attributs du DOM.
import wordsTxt from './words.txt?raw';
import patternsTxt from './patterns.txt?raw';
import serverTxt from './server.txt?raw';
import { IS_EN } from './lang.js';

const norm = (s) => s.replace(/[  ]/g, ' ').replace(/’/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const exact = new Map();
const pats = [];
const esc = (s) => s.replace(/[.*+?^$()|\\/]/g, '\\$&');

function load(txt) {
  for (const line of txt.split('\n')) {
    const i = line.indexOf(' => ');
    if (i < 0 || !line.trim()) continue;
    const fr = norm(line.slice(0, i)); const en = line.slice(i + 4).trim();
    if (/\{\}/.test(fr)) {
      const parts = fr.split(/(\{\}|\[s\])/).map((p) => (p === '{}' ? '(.+?)' : p === '[s]' ? '(?:s)?' : esc(p)));
      pats.push({ re: new RegExp(`^${parts.join('')}$`), en, len: fr.replace(/\{\}|\[s\]/g, '').length });
    } else if (!exact.has(fr)) exact.set(fr, en);
  }
}
load(wordsTxt); load(patternsTxt); load(serverTxt);
pats.sort((a, b) => b.len - a.len);

const cache = new Map();
function tr1(s) {
  const n = norm(s);
  if (!n) return null;
  let r = exact.get(n);
  if (r != null) return r;
  for (const p of pats) {
    const m = p.re.exec(n);
    if (!m) continue;
    return p.en.replace(/\{(\d)(?:\|([^|}]*)\|([^|}]*))?\}/g, (_, k, a, b) => {
      const v = m[+k] ?? '';
      if (a !== undefined) return Number(String(v).replace(/[^\d.-]/g, '')) > 1 ? b : a;
      return tr(v);
    });
  }
  // MAJUSCULES → minuscules → traduit → MAJUSCULES ; première lettre en minuscule
  if (n.length > 3 && n === n.toUpperCase() && n !== n.toLowerCase()) { r = exact.get(n[0] + n.slice(1).toLowerCase()); if (r != null) return r.toUpperCase(); }
  if (/^[a-zà-ÿ]/.test(n)) { r = exact.get(n[0].toUpperCase() + n.slice(1)); if (r != null) return r[0].toLowerCase() + r.slice(1); }
  // fragments numériques insérés dans un texte composé
  const inl = n.replace(/(\d[\d.,]*) j de retard/g, '$1 days late').replace(/(\d[\d.,]*) km de retard/g, '$1 km overdue').replace(/\breste (\d[\d.,]*)/g, 'remaining $1').replace(/\bdans (\d[\d.,]*) km/g, 'in $1 km').replace(/Embauché le/g, 'Hired on').replace(/dans (\d+) j\b/g, 'in $1 days');
  if (inl !== n) return inl;
  // chaînes composées « a · b » ou « a — b » : traduire chaque morceau
  if (/ [·—] /.test(n)) { const parts = n.split(/( [·—] )/); let ch = false; const o = parts.map((x, i) => { if (i % 2) return x; const y = tr1(x); if (y != null) ch = true; return y ?? x; }); if (ch) return o.join(''); }
  return null;
}
/** Traduit une chaîne (en conservant les espaces de début/fin). Renvoie la chaîne telle quelle si inconnue. */
export function tr(s) {
  if (!IS_EN || typeof s !== 'string' || !s) return s;
  if (cache.has(s)) return cache.get(s);
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  const t = tr1(m[2]);
  const out = t == null ? s : m[1] + t + m[3];
  if (cache.size > 5000) cache.clear();
  cache.set(s, out);
  return out;
}
export const _debug = { exact, pats };

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);
// React écrit chaque expression JSX dans un nœud texte distinct (« 3 », « camion », « s », « en perte ») :
// on traduit d'abord la suite de nœuds texte adjacents comme une seule phrase, puis nœud par nœud.
const mine = new WeakMap();   // nœud -> valeur qu'on y a écrite
const orig = new WeakMap();   // nœud -> valeur française d'origine
const isMine = (n) => mine.has(n) && mine.get(n) === n.nodeValue;
const frOf = (n) => (isMine(n) ? orig.get(n) : n.nodeValue);
function write(n, from, to) { if (n.nodeValue !== to) { orig.set(n, from); mine.set(n, to); n.nodeValue = to; } else if (from !== to) { orig.set(n, from); mine.set(n, to); } }
function textRun(n) {
  let a = n; while (a.previousSibling && a.previousSibling.nodeType === 3) a = a.previousSibling;
  const run = []; for (let c = a; c && c.nodeType === 3; c = c.nextSibling) run.push(c); return run;
}
function doRun(run) {
  const frs = run.map(frOf);
  if (run.length > 1) {
    const joined = frs.join(''); const t = tr(joined);
    if (t !== joined) { write(run[0], frs[0], t); for (let i = 1; i < run.length; i++) write(run[i], frs[i], ''); return; }
  }
  run.forEach((x, i) => { const f = frs[i]; if (!f || !f.trim()) { if (isMine(x)) write(x, f, f); return; } const t = tr(f); if (t !== x.nodeValue) write(x, f, t); });
}
function doText(n) { const p = n.parentNode; if (!p || SKIP.has(p.nodeName)) return; doRun(textRun(n)); }
function walk(n) {
  if (n.nodeType === 3) { doText(n); return; }
  if (n.nodeType !== 1 || n.nodeName === 'SCRIPT' || n.nodeName === 'STYLE') return;
  for (const a of ATTRS) { const v = n.getAttribute(a); if (v) { const t = tr(v); if (t !== v) n.setAttribute(a, t); } }
  if (n.nodeName === 'INPUT' && (n.type === 'button' || n.type === 'submit') && n.value) { const t = tr(n.value); if (t !== n.value) n.value = t; }
  if (SKIP.has(n.nodeName)) return;   // ne pas traduire le contenu saisi (textarea…)
  let c = n.firstChild;
  while (c) {
    if (c.nodeType === 3) { const run = textRun(c); const last = run[run.length - 1]; doRun(run); c = last.nextSibling; } else { walk(c); c = c.nextSibling; }
  }
}

export function startI18n() {
  document.documentElement.lang = IS_EN ? 'en' : 'fr';
  if (!IS_EN) return;
  document.title = tr(document.title);
  const oc = window.confirm.bind(window); window.confirm = (m) => oc(tr(String(m)));
  const oa = window.alert.bind(window); window.alert = (m) => oa(tr(String(m)));
  walk(document.body);
  new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.type === 'childList') r.addedNodes.forEach(walk);
      else if (r.type === 'characterData') { if (!isMine(r.target)) walk(r.target); }
      else if (r.type === 'attributes') walk(r.target);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
