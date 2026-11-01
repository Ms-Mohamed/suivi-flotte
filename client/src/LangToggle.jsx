import React from 'react';
import { Globe } from 'lucide-react';
import { IS_EN, setLang } from './i18n/lang.js';

/** Bouton de changement de langue (EN ⇄ FR). Le libellé reste dans la langue cible. */
export default function LangToggle({ className = 'navlink' }) {
  return (
    <button type="button" className={className} onClick={() => setLang(IS_EN ? 'fr' : 'en')} aria-label={IS_EN ? 'Switch to French' : 'Passer en anglais'} data-lang-toggle>
      <Globe size={19} />{IS_EN ? 'Français' : 'English'}
    </button>
  );
}
