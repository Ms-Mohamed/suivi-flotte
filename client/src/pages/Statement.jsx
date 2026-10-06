import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Printer, Copy, Check, Loader2, AlertCircle, Info, Save, Plus, ClipboardList, History } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { api, download } from '../api.js';
import { PLAN, calcEntry, CODE_VENTES, CODE_GAZOLE, CODES_ANNUELS, MONTH_RE, currentMonth } from '../../../shared/calc.js';
import { useApp } from '../App.jsx';
import { MonthPicker, NumInput, Segmented, Plate, Spinner, useToast } from '../components.jsx';
import { dhs, n0, n2, monthLong, tone } from '../format.js';
import OperationForm, { todayStr } from './OperationForm.jsx';

const GCOL = { variables: '#2f5bea', fixes: '#12a594', amortissements: '#f5a524' };

export default function Statement() {
  const { id, month: monthParam } = useParams();
  const month = MONTH_RE.test(monthParam) ? monthParam : currentMonth();
  const { settings, user } = useApp();
  const canEdit = user.role !== 'lecture';
  const nav = useNavigate(); const toast = useToast();
  const [info, setInfo] = useState(null);       // { truck, exists, fromPrevious }
  const [entry, setEntry] = useState(null);
  const [ops, setOps] = useState({ totals: {}, km: 0, n: 0 });  // opérations datées du mois (lecture seule ici)
  const [opForm, setOpForm] = useState(false);
  const [trucks, setTrucks] = useState([]);
  const [status, setStatus] = useState('new');  // new | dirty | saving | saved | error
  const [savedAt, setSavedAt] = useState(null);
  const entryRef = useRef(null); const dirty = useRef(false); const timer = useRef(null);
  entryRef.current = entry;

  const persist = useCallback(async (tid, m, body) => {
    setStatus('saving');
    try { const r = await api(`/entries/${tid}/${m}`, { method: 'PUT', body }); setStatus('saved'); setSavedAt(new Date(r.updatedAt)); dirty.current = false; return true; }
    catch (e) { setStatus('error'); toast(`Enregistrement impossible : ${e.message}`, 'err'); return false; }
  }, [toast]);

  useEffect(() => {
    let live = true; setEntry(null); setInfo(null); dirty.current = false; setStatus('new');
    api(`/entries/${id}/${month}`).then((r) => {
      if (!live) return;
      setInfo({ truck: r.truck, exists: r.exists, fromPrevious: r.entry.fromPrevious || null });
      const { fromPrevious, ...e } = r.entry; setEntry(e); setOps(r.ops || { totals: {}, km: 0, n: 0 });
      setStatus(r.exists ? 'saved' : 'new'); setSavedAt(r.updatedAt ? new Date(r.updatedAt) : null);
    }).catch((e) => { toast(e.message, 'err'); nav('/camions'); });
    return () => { live = false; clearTimeout(timer.current); if (dirty.current && entryRef.current) persist(id, month, entryRef.current); };
  }, [id, month]); // eslint-disable-line

  // sauvegarde automatique 0,8 s après la dernière modification
  useEffect(() => {
    if (!dirty.current || !entry) return undefined;
    setStatus('dirty'); clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(id, month, entry), 800);
    return () => clearTimeout(timer.current);
  }, [entry]); // eslint-disable-line

  const edit = (fn) => { if (!canEdit) return; dirty.current = true; setEntry((e) => fn(e)); };
  const setField = (k, v) => edit((e) => ({ ...e, [k]: v }));
  const setAmount = (code, v) => edit((e) => ({ ...e, amounts: { ...e.amounts, [code]: v } }));
  const setAnnuel = (code, v) => edit((e) => ({ ...e, annuel: { ...e.annuel, [code]: v } }));
  const setMode = (code, m) => edit((e) => ({ ...e, modes: { ...e.modes, [code]: m } }));

  const c = useMemo(() => (entry && settings ? calcEntry({ ...entry, ops }, settings) : null), [entry, ops, settings]);
  useEffect(() => { api('/trucks').then(setTrucks).catch(() => {}); }, []);
  if (!entry || !c || !info) return <div className="page"><div className="center"><Spinner /></div></div>;
  const { truck } = info;

  const applyModele = async () => {
    try {
      const m = await api(`/entries/${id}/${month}/modele`);
      edit((e) => ({ ...e, amounts: { ...e.amounts, ...m.amounts }, annuel: { ...e.annuel, ...m.annuel }, modes: { ...e.modes, ...m.modes },
        tarifKm: e.tarifKm || m.tarifKm, prixLitre: e.prixLitre || m.prixLitre }));
      toast(m.fromPrevious ? `Charges fixes reprises de ${monthLong(m.fromPrevious)}` : 'Valeurs par défaut du camion appliquées');
    } catch (e) { toast(e.message, 'err'); }
  };
  const refreshOps = async () => { try { const r = await api(`/entries/${id}/${month}`); setOps(r.ops || { totals: {}, km: 0, n: 0 }); } catch { /* ignore */ } };
  const monthRange = `from=${month}-01&to=${month}-31`;
  const saveNow = async () => { clearTimeout(timer.current); dirty.current = true; if (await persist(id, month, entry)) toast('Situation enregistrée'); };

  return (
    <div className="page statement">
      <div className="page-head no-print">
        <div>
          <Link to="/camions" className="back"><ArrowLeft size={16} />Camions</Link>
          <h1 className="with-plate"><Plate>{truck.immatriculation}</Plate><span>Situation camion</span></h1>
          <p className="muted">{[truck.marque, truck.modele].filter(Boolean).join(' ')}{truck.chauffeur ? ` · Chauffeur : ${truck.chauffeur}` : ''}</p>
        </div>
        <div className="head-actions">
          <MonthPicker value={month} onChange={(m) => nav(`/camion/${id}/${m}`)} />
          <button className="btn" onClick={() => download(`/export/entry/${id}/${month}`, `${truck.immatriculation}-${month}.xlsx`).catch((e) => toast(e.message, 'err'))}><Download size={17} />Excel</button>
          <button className="btn" onClick={() => window.print()}><Printer size={17} />Imprimer / PDF</button>
        </div>
      </div>
      <div className="print-title">Situation camion {truck.immatriculation} — {monthLong(month)}</div>

      {canEdit ? (
        <div className="statusbar no-print">
          <SaveStatus status={status} at={savedAt} />
          <div className="grow" />
          <button className="btn sm" onClick={applyModele}><Copy size={15} />Reprendre les charges fixes</button>
          <button className="btn sm primary" onClick={saveNow} disabled={status === 'saving'}><Save size={15} />Enregistrer</button>
        </div>
      ) : <div className="alert info no-print"><Info size={18} /><div><strong>Lecture seule.</strong> Votre compte permet de consulter et d’exporter, pas de modifier les saisies.</div></div>}
      {canEdit && !info.exists && status === 'new' && (
        <div className="alert info no-print"><Info size={18} /><div><strong>Nouveau mois.</strong> {info.fromPrevious ? `Les charges fixes ont été reprises de ${monthLong(info.fromPrevious)}.` : 'Les valeurs par défaut du camion ont été appliquées.'} Saisissez les kilomètres, le carburant et les autres montants : l’enregistrement est automatique.</div></div>
      )}

      <div className="stmt-grid">
        <fieldset className="plain stmt-main" disabled={!canEdit}>
          <section className="card">
            <div className="card-head"><h3>Activité du mois</h3><span className="muted">Alimente automatiquement les ventes et le gazole</span></div>
            <div className="activity">
              <Field label="Km parcourus chargés"><NumInput value={entry.km} onChange={(v) => setField('km', v)} suffix="km" aria-label="Km parcourus chargés" /></Field>
              <Field label="Tarif au km"><NumInput value={entry.tarifKm} onChange={(v) => setField('tarifKm', v)} suffix="DHS/km" aria-label="Tarif au km" /></Field>
              <Field label="Gazole consommé"><NumInput value={entry.litres} onChange={(v) => setField('litres', v)} suffix="L" aria-label="Gazole consommé" /></Field>
              <Field label="Prix moyen du litre"><NumInput value={entry.prixLitre} onChange={(v) => setField('prixLitre', v)} suffix="DHS/L" aria-label="Prix moyen du litre" /></Field>
            </div>
          </section>

          <section className="card no-print">
            <div className="card-head"><h3><ClipboardList size={18} />Opérations datées du mois</h3>
              <span className="muted">{ops.n ? `${ops.n} ligne${ops.n > 1 ? 's' : ''} · déjà comprises dans les montants ci-dessous` : 'Aucune — les voyages et dépenses saisis avec une date s’ajoutent ici automatiquement'}</span></div>
            <div className="opsbox">
              <div className="btns">
                {canEdit && <button type="button" className="btn sm primary" onClick={() => setOpForm(true)}><Plus size={15} />Ajouter une opération</button>}
                <Link className="btn sm" to={`/operations?truck=${id}&${monthRange}`}><History size={15} />Voir le journal du mois</Link>
              </div>
              {ops.km > 0 && <span className="muted small">dont {n0(ops.km)} km saisis par opération</span>}
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h3>A. Produits Mensuels <small>(Chiffre d’Affaires)</small></h3><b className="sectotal">{dhs(c.A, 2)}</b></div>
            <AccountHead cols={['N° Compte', 'Postes de Produits · Mode de Calcul Mensuel', 'Saisie', 'Montant (DHS)']} />
            {PLAN.produits.map((a) => <AccountRow key={a.code} acc={a} entry={entry} calc={c} api={{ setAmount, setAnnuel, setMode }} />)}
            <TotalRow label="TOTAL A" desc={PLAN.totaux.A} value={c.A} />
          </section>

          <section className="card">
            <div className="card-head"><h3>B. Charges Mensuelles</h3><b className="sectotal">{dhs(c.B, 2)}</b></div>
            <AccountHead cols={['N° Compte', 'Postes de Charges · Nature / Fréquence', 'Saisie', 'Montant (DHS)']} />
            {PLAN.charges.map((g) => (
              <div key={g.key} className="group">
                <div className="group-head"><i style={{ background: GCOL[g.key] }} /><strong>{g.titre}</strong><span>{g.note}</span><b>{dhs(c.sousTotaux[g.key], 2)}</b></div>
                {g.comptes.map((a) => <AccountRow key={a.code} acc={a} entry={entry} calc={c} api={{ setAmount, setAnnuel, setMode }} />)}
              </div>
            ))}
            <TotalRow label="TOTAL B" desc={PLAN.totaux.B} value={c.B} />
          </section>

          <section className="card">
            <div className="card-head"><h3>Calcul du Résultat Mensuel</h3></div>
            <div className="calc">
              <CalcRow label="Total Produits (A)" formula={PLAN.resultat[0].formule} value={c.A} />
              <CalcRow label="Total Charges (B)" formula={PLAN.resultat[1].formule} value={c.B} />
              <CalcRow strong label="RÉSULTAT BRUT MENSUEL" formula="Résultat Brut = Total Produits (A) − Total Charges (B)" value={c.brut} signed />
              <div className="calc-row">
                <div><b>Impôt / Taxe sur résultat</b><small>{PLAN.resultat[3].formule}</small>
                  <div className="tax-ctl no-print">
                    <Segmented label="Mode impôt" value={entry.impot?.mode || 'auto'} onChange={(m) => edit((e) => ({ ...e, impot: { mode: m, montant: e.impot?.montant || c.impotAuto } }))} options={[{ value: 'auto', label: 'Automatique' }, { value: 'manuel', label: 'Saisie manuelle' }]} />
                    {(entry.impot?.mode || 'auto') === 'manuel'
                      ? <NumInput value={entry.impot?.montant || 0} onChange={(v) => edit((e) => ({ ...e, impot: { mode: 'manuel', montant: v } }))} suffix="DHS" aria-label="Impôt manuel" />
                      : <small className="muted">IS {n2(settings.tauxIS)} % du brut positif{settings.cotisationMinimaleActive ? `, plancher : cotisation minimale ${n2(settings.cotisationMinimale)} % des produits` : ''} (réglable dans Paramètres)</small>}
                  </div>
                </div>
                <b className="amt">{dhs(c.impot, 2)}</b>
              </div>
              <CalcRow strong big label="RÉSULTAT NET MENSUEL" formula="Résultat Net = Résultat Brut − Impôt (T)" value={c.net} signed />
            </div>
          </section>

          <section className="card no-print">
            <div className="card-head"><h3>Notes du mois</h3></div>
            <textarea className="notes" rows={3} placeholder="Observations, incidents, remarques…" value={entry.notes} onChange={(e) => setField('notes', e.target.value)} maxLength={2000} />
          </section>
        </fieldset>

        <aside className="stmt-side">
          <div className={`result-panel ${c.net < 0 ? 'neg' : 'pos'}`}>
            <small>Résultat net — {monthLong(month)}</small>
            <strong className="big-net">{dhs(c.net)}</strong>
            <span className={`pill ${c.net < 0 ? 'neg' : 'pos'}`}>{c.A ? `${n2(c.marge)} % de marge nette` : 'Aucun produit saisi'}</span>
            <div className="split">
              <div style={{ width: `${c.A + c.B ? (c.A / (c.A + c.B)) * 100 : 50}%` }} className="a" />
              <div style={{ width: `${c.A + c.B ? (c.B / (c.A + c.B)) * 100 : 50}%` }} className="b" />
            </div>
            <div className="split-legend"><span><i className="a" />Produits {n0(c.A)}</span><span><i className="b" />Charges {n0(c.B)}</span></div>
            {c.B > 0 && (
              <div className="mini-donut">
                <ResponsiveContainer width={110} height={110}><PieChart><Pie isAnimationActive={false} data={PLAN.charges.map((g) => ({ k: g.key, v: c.sousTotaux[g.key] }))} dataKey="v" innerRadius={34} outerRadius={50} paddingAngle={2} stroke="none">{PLAN.charges.map((g) => <Cell key={g.key} fill={GCOL[g.key]} />)}</Pie></PieChart></ResponsiveContainer>
                <ul>{PLAN.charges.map((g) => <li key={g.key}><i style={{ background: GCOL[g.key] }} />{g.titre.replace('CHARGES ', '').toLowerCase()}<b>{n0((c.sousTotaux[g.key] / c.B) * 100)} %</b></li>)}</ul>
              </div>
            )}
            <dl className="metrics">
              <div><dt>Résultat brut</dt><dd className={tone(c.brut)}>{dhs(c.brut)}</dd></div>
              <div><dt>Impôt estimé</dt><dd>{dhs(c.impot)}</dd></div>
              <div><dt>Coût / km</dt><dd>{c.km ? `${n2(c.coutKm)} DHS` : '—'}</dd></div>
              <div><dt>Résultat / km</dt><dd className={tone(c.margeKm)}>{c.km ? `${n2(c.margeKm)} DHS` : '—'}</dd></div>
              <div><dt>Consommation</dt><dd>{c.km && entry.litres ? `${n2(c.conso)} L/100 km` : '—'}</dd></div>
            </dl>
          </div>
        </aside>
      </div>
      {opForm && <OperationForm trucks={trucks} initial={{ truck: id, date: month === currentMonth() ? todayStr() : `${month}-01` }} onClose={() => setOpForm(false)} onSaved={refreshOps} />}
    </div>
  );
}

const Field = ({ label, children }) => <label className="field"><span>{label}</span>{children}</label>;
const AccountHead = ({ cols }) => <div className="acc-head">{cols.map((c) => <span key={c}>{c}</span>)}</div>;
const TotalRow = ({ label, desc, value }) => <div className="acc-total"><b>{label}</b><span>{desc}</span><b className="amt">{dhs(value, 2)}</b></div>;
const CalcRow = ({ label, formula, value, strong, big, signed }) => (
  <div className={`calc-row ${strong ? 'strong' : ''} ${big ? 'big' : ''}`}><div><b>{label}</b><small>{formula}</small></div><b className={`amt ${signed ? tone(value) : ''}`}>{dhs(value, 2)}</b></div>
);

function SaveStatus({ status, at }) {
  const hh = at ? at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
  if (status === 'saving') return <span className="save busy"><Loader2 size={15} className="spin" />Enregistrement…</span>;
  if (status === 'dirty') return <span className="save dirty">Modifications en cours…</span>;
  if (status === 'error') return <span className="save err"><AlertCircle size={15} />Non enregistré — réessayez</span>;
  if (status === 'saved') return <span className="save ok"><Check size={15} />Enregistré{hh ? ` à ${hh}` : ''}</span>;
  return <span className="save">Pas encore enregistré</span>;
}

function AccountRow({ acc, entry, calc, api: a }) {
  const { code } = acc;
  const modes = entry.modes || {};
  const opsPart = calc.opsLignes?.[code] || 0;
  const base = Math.round((calc.lignes[code] - opsPart) * 100) / 100;   // montant de la fiche, hors opérations datées
  let ctl;
  if (code === CODE_VENTES) {
    const m = modes[code] === 'factures' ? 'factures' : 'calcul';
    ctl = (<>
      <Segmented label="Mode ventes" value={m} onChange={(v) => a.setMode(code, v)} options={[{ value: 'calcul', label: 'Km × tarif' }, { value: 'factures', label: 'Total factures' }]} />
      {m === 'calcul' ? <><NumInput readOnly value={base} suffix="DHS" aria-label={acc.label} /><small className="hint">{n0(entry.km)} km × {n2(entry.tarifKm)} DHS</small></>
        : <NumInput value={entry.amounts[code] || 0} onChange={(v) => a.setAmount(code, v)} suffix="DHS" aria-label={acc.label} />}
    </>);
  } else if (code === CODE_GAZOLE) {
    const m = modes[code] === 'montant' ? 'montant' : 'calcul';
    ctl = (<>
      <Segmented label="Mode gazole" value={m} onChange={(v) => a.setMode(code, v)} options={[{ value: 'calcul', label: 'Litres × prix' }, { value: 'montant', label: 'Montant' }]} />
      {m === 'calcul' ? <><NumInput readOnly value={base} suffix="DHS" aria-label={acc.label} /><small className="hint">{n0(entry.litres)} L × {n2(entry.prixLitre)} DHS</small></>
        : <NumInput value={entry.amounts[code] || 0} onChange={(v) => a.setAmount(code, v)} suffix="DHS" aria-label={acc.label} />}
    </>);
  } else if (CODES_ANNUELS.includes(code)) {
    const m = modes[code] === 'mensuel' ? 'mensuel' : 'annuel';
    ctl = (<>
      <Segmented label="Mode" value={m} onChange={(v) => a.setMode(code, v)} options={[{ value: 'annuel', label: 'Annuel ÷ 12' }, { value: 'mensuel', label: 'Mensuel' }]} />
      {m === 'annuel' ? <><NumInput value={entry.annuel?.[code] || 0} onChange={(v) => a.setAnnuel(code, v)} suffix="DHS/an" aria-label={`${acc.label} annuel`} /><small className="hint">= {n2(base)} DHS par mois</small></>
        : <NumInput value={entry.amounts[code] || 0} onChange={(v) => a.setAmount(code, v)} suffix="DHS" aria-label={acc.label} />}
    </>);
  } else {
    ctl = <NumInput value={entry.amounts[code] || 0} onChange={(v) => a.setAmount(code, v)} suffix="DHS" aria-label={acc.label} />;
  }
  return (
    <div className="acc-row">
      <span className="code">{code}</span>
      <div className="acc-name"><b>{acc.label}</b><small>{acc.mode}</small>
        {opsPart > 0 && <small className="ops-badge"><ClipboardList size={12} /> dont {n2(opsPart)} DHS d’opérations datées</small>}</div>
      <div className="acc-ctl">{ctl}</div>
      <b className="amt">{n2(calc.lignes[code])}</b>
    </div>
  );
}
