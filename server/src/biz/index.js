import { mountCommercial } from './commercial.js';
import { mountFleetExtra } from './fleetExtra.js';
import { mountSousTraitance } from './sousTraitance.js';
import { mountAchats } from './achats.js';
import { mountRH } from './rh.js';
export function mountBiz(r) { mountCommercial(r); mountFleetExtra(r); mountSousTraitance(r); mountAchats(r); mountRH(r); }
