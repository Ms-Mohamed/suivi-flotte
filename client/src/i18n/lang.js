// Langue de l'interface : anglais par défaut, français via le bouton (persisté, rechargement de la page).
export const LANG = (() => { try { return localStorage.getItem('sf_lang') === 'fr' ? 'fr' : 'en'; } catch { return 'en'; } })();
export const IS_EN = LANG === 'en';
export const LOCALE = IS_EN ? 'en-GB' : 'fr-FR';
export const NUM_LOCALE = IS_EN ? 'en-US' : 'fr-FR';
export const DEC = IS_EN ? '.' : ',';
export function setLang(l) {
  try { localStorage.setItem('sf_lang', l === 'fr' ? 'fr' : 'en'); } catch { /* ignore */ }
  window.location.reload();
}
