import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Printer, Download, AlertTriangle, Info, ClipboardList } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, PieChart, Pie, Cell } from 'recharts';
import { api, download } from '../api.js';
import { addMonths, currentMonth } from '../../../shared/calc.js';
import { Kpi, Delta, Plate, Spinner, Empty, useToast } from '../components.jsx';
import { dhs, n0, n2, monthLong, monthShort, compact, tone, fmtDateTime } from '../format.js';

const GCOL = { variables: '#2f5bea', fixes: '#12a594', amortissements: '#f5a524' };
const GLAB = { variables: 'Charges variables', fixes: 'Charges fixes', amortissements: 'Amortissements' };
const PRESETS = () => {
  const cur = currentMonth(), y = cur.slice(0, 4), q = Math.floor((+cur.slice(5) - 1) / 3) * 3 + 1;
  const qs = `${y}-${String(q).padStart(2, '0')}`;
  return [
    { k: 'mois', label: 'Ce mois', from: cur, to: cur },
    { k: 'dernier', label: 'Mois dernier', from: addMonths(cur, -1), to: addMonths(cur, -1) },
    { k: 'trim', label: 'Ce trimestre', from: qs, to: cur },
    { k: '12', label: '12 derniers mois', from: addMonths(cur, -11), to: cur },
    { k: 'annee', label: `Année ${y}`, from: `${y}-01`, to: cur },
    { k: 'prec', label: `Année ${+y - 1}`, from: `${+y - 1}-01`, to: `${+y - 1}-12` },
  ];
};
const periodLabel = (from, to) => (from === to ? monthLong(from) : `${monthLong(from)} → ${monthLong(to)}`);

export default function Rapport() {
  const toast = useToast();
  const nav = useNavigate();
  const [p, setP] = useState(() => { const x = PRESETS().find((z) => z.k === 'annee'); return { from: x.from, to: x.to, k: 'annee' }; });
  const [d, setD] = useState(null);
  useEffect(() => { setD(null); api(`/reports/global?from=${p.from}&to=${p.to}`).then(setD).catch((e) => { toast(e.message, 'err'); setD(false); }); }, [p.from, p.to]); // eslint-disable-line
  const t = d?.totaux, pr = d?.totauxPrecedents;
  const maxAbs = d ? Math.max(1, ...d.camions.map((c) => Math.abs(c.net))) : 1;
  const grp = d ? Object.entries(d.groupes).filter(([, v]) => v > 0) : [];

  return (
    <div className="page rapport">
      <div className="page-head no-print">
        <div><h1>Rapport global</h1><p className="muted">Synthèse de gestion de toute la flotte sur la période choisie, prête à imprimer ou à exporter.</p></div>
        <div className="head-actions">
          <button className="btn" disabled={!d} onClick={() => download(`/export/rapport?from=${p.from}&to=${p.to}`, `rapport-${p.from}_${p.to}.xlsx`).catch((e) => toast(e.message, 'err'))}><Download size={17} />Excel</button>
          <button className="btn primary" disabled={!d} onClick={() => window.print()}><Printer size={17} />Imprimer / PDF</button>
        </div>
      </div>

      <div className="card no-print" style={{ padding: 14 }}>
        <div className="opsbox">
          <div className="btns">{PRESETS().map((x) => <button key={x.k} className={`chip-btn ${p.k === x.k ? 'on' : ''}`} onClick={() => setP({ from: x.from, to: x.to, k: x.k })}>{x.label}</button>)}</div>
          <div className="btns" style={{ alignItems: 'center' }}>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><span>Du</span><input type="month" value={p.from} max={p.to} onChange={(e) => e.target.value && setP({ ...p, from: e.target.value, k: '' })} /></label>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><span>au</span><input type="month" value={p.to} min={p.from} onChange={(e) => e.target.value && setP({ ...p, to: e.target.value, k: '' })} /></label>
          </div>
        </div>
      </div>

      {d === false ? <Empty title="Rapport indisponible">Vérifiez la période choisie.</Empty> : !d ? <div className="center"><Spinner /></div> : (
        <>
          <div className="print-title">
            <div>{d.parametres.societe} — Rapport de gestion</div>
            <small>Période : {periodLabel(d.from, d.to)} · {d.nbMois} mois · généré le {fmtDateTime(d.genereLe)}</small>
          </div>
          <h2 className="rp-period no-print">{periodLabel(d.from, d.to)} <small className="muted">· {d.nbMois} mois · comparé à {periodLabel(d.precedente.from, d.precedente.to)}</small></h2>

          {t.A === 0 && t.B === 0 ? <Empty title="Aucune donnée sur cette période">Choisissez une autre période ou saisissez des mois / opérations.</Empty> : (
            <>
              <section className="kpis" style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
                <Kpi label="Produits (A)" value={dhs(t.A)}><Delta current={t.A} previous={pr.A} /></Kpi>
                <Kpi label="Charges (B)" value={dhs(t.B)}><Delta current={t.B} previous={pr.B} invert /></Kpi>
                <Kpi accent label="Résultat net" value={dhs(t.net)} tone={tone(t.net)}><Delta current={t.net} previous={pr.net} /><span>marge {n2(t.marge)} %</span></Kpi>
                <Kpi label="Coût au km" value={t.km ? `${n2(t.coutKm)} DHS` : '—'}><span>{n0(t.km)} km · {n2(t.resultatKm)} DHS/km net</span></Kpi>
              </section>

              {(d.enPerte.length > 0 || d.fichesManquantes.total > 0 || d.parametres.moisEnModeOperations > 0 || d.to >= currentMonth()) && (
                <div className="alerts">
                  {d.to >= currentMonth() && <div className="alert warn"><Info size={18} /><div><strong>Le dernier mois est en cours.</strong> Ses charges fixes sont comptées pour le mois entier alors que les recettes et dépenses des voyages ne sont pas toutes saisies : son résultat est provisoire.</div></div>}
                  {d.enPerte.length > 0 && <div className="alert bad"><AlertTriangle size={18} /><div><strong>{d.enPerte.length} camion{d.enPerte.length > 1 ? 's' : ''} en perte sur la période :</strong> {d.enPerte.map((c, i) => <span key={c._id}>{i ? ', ' : ''}<Link to={`/camion/${c._id}`}>{c.immatriculation}</Link> ({n0(c.net)} DHS)</span>)}.</div></div>}
                  {d.fichesManquantes.total > 0 && <div className="alert warn"><AlertTriangle size={18} /><div><strong>{d.fichesManquantes.total} fiche{d.fichesManquantes.total > 1 ? 's' : ''} mensuelle{d.fichesManquantes.total > 1 ? 's' : ''} non saisie{d.fichesManquantes.total > 1 ? 's' : ''}</strong> (ex. {d.fichesManquantes.exemples.slice(0, 4).map((x) => `${x.truck} ${monthShort(x.month)}`).join(', ')}{d.fichesManquantes.total > 4 ? '…' : ''}) : les charges fixes de ces mois ne sont pas comptées, le résultat est donc surévalué.</div></div>}
                  {d.parametres.moisEnModeOperations > 0 && <div className="alert info"><Info size={18} /><div>{d.parametres.moisEnModeOperations} mois de la période sont en <strong>mode opérations</strong> (depuis {d.parametres.dateBascule}) : recettes et charges variables viennent des opérations datées.</div></div>}
                </div>
              )}

              <section className="card">
                <div className="card-head"><h3>Évolution mensuelle de la flotte</h3></div>
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart data={d.trend.map((m) => ({ ...m, label: d.nbMois > 14 ? `${monthShort(m.month)} ${m.month.slice(2, 4)}` : monthShort(m.month) }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--mute)' }} />
                    <YAxis tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--mute)' }} width={56} />
                    <Tooltip cursor={{ fill: 'var(--hover)' }} formatter={(v) => dhs(v)} labelFormatter={(_, pl) => (pl?.[0] ? monthLong(pl[0].payload.month) : '')} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar isAnimationActive={false} dataKey="A" name="Produits" fill="#0e9f6e" radius={[4, 4, 0, 0]} maxBarSize={22} />
                    <Bar isAnimationActive={false} dataKey="B" name="Charges" fill="#f5a524" radius={[4, 4, 0, 0]} maxBarSize={22} />
                    <Line isAnimationActive={false} type="monotone" dataKey="net" name="Résultat net" stroke="#2f5bea" strokeWidth={2} dot={d.nbMois < 14} />
                  </ComposedChart>
                </ResponsiveContainer>
                {d.meilleurMois && d.nbMois > 1 && <p className="muted small" style={{ margin: '8px 0 0' }}>Meilleur mois : <b>{monthLong(d.meilleurMois.month)}</b> ({dhs(d.meilleurMois.net)}) · Pire mois : <b>{monthLong(d.pireMois.month)}</b> ({dhs(d.pireMois.net)})</p>}
              </section>

              <section className="card table-wrap">
                <div className="card-head"><h3>Classement des camions</h3><span className="muted small">par résultat net décroissant</span></div>
                <table className="tbl">
                  <thead><tr><th>#</th><th>Camion</th><th className="r">Produits</th><th className="r">Charges</th><th className="r">Résultat net</th><th /><th className="r">Marge</th><th className="r">Km</th><th className="r">Coût/km</th><th className="r">Mois en perte</th><th className="r">Fiches</th></tr></thead>
                  <tbody>
                    {d.camions.map((c, i) => (
                      <tr key={c.truck._id} className="click" onClick={() => nav(`/camion/${c.truck._id}`)}>
                        <td className="muted">{i + 1}</td>
                        <td><Plate>{c.truck.immatriculation}</Plate>{!c.truck.actif && <span className="pill warn" style={{ marginLeft: 6 }}>archivé</span>}</td>
                        <td className="r">{n0(c.A)}</td><td className="r">{n0(c.B)}</td>
                        <td className={`r ${tone(c.net)}`}><b>{n0(c.net)}</b></td>
                        <td><div className="bar-cell" style={{ minWidth: 90 }}>{c.mois > 0 && <i className={c.net < 0 ? 'n' : ''} style={{ width: `${Math.max(3, (Math.abs(c.net) / maxAbs) * 80)}px` }} />}</div></td>
                        <td className={`r ${tone(c.marge)}`}>{c.A ? `${n2(c.marge)} %` : '—'}</td>
                        <td className="r">{n0(c.km)}</td><td className="r">{c.km ? n2(c.coutKm) : '—'}</td>
                        <td className="r">{c.mois ? `${c.moisPerte} / ${c.mois}` : '—'}</td>
                        <td className="r">{c.saisis} / {c.attendus}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td /><td>FLOTTE</td><td className="r">{n0(t.A)}</td><td className="r">{n0(t.B)}</td><td className={`r ${tone(t.net)}`}>{n0(t.net)}</td><td /><td className="r">{t.A ? `${n2(t.marge)} %` : '—'}</td><td className="r">{n0(t.km)}</td><td className="r">{t.km ? n2(t.coutKm) : '—'}</td><td /><td /></tr></tfoot>
                </table>
              </section>

              <div className="grid-3-2">
                <section className="card">
                  <div className="card-head"><h3>Où part l’argent</h3><span className="muted small">{dhs(t.B)} de charges</span></div>
                  <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                    <PieChart width={150} height={150}><Pie isAnimationActive={false} data={grp.map(([k, v]) => ({ k, v }))} dataKey="v" innerRadius={46} outerRadius={68} paddingAngle={2} stroke="none">{grp.map(([k]) => <Cell key={k} fill={GCOL[k]} />)}</Pie></PieChart>
                    <ul className="legend-list">{grp.map(([k, v]) => <li key={k}><i style={{ background: GCOL[k] }} />{GLAB[k]}<b>{n0((v / t.B) * 100)} %</b><span className="muted">{dhs(v)}</span></li>)}</ul>
                  </div>
                  <table className="tbl" style={{ marginTop: 10 }}><tbody>
                    {d.charges.slice(0, 8).map((x) => <tr key={x.code}><td><i className="dot" style={{ background: GCOL[x.groupe] }} /> {x.label}</td><td className="r">{n0(x.montant)}</td><td className="r muted">{n0((x.montant / t.B) * 100)} %</td></tr>)}
                  </tbody></table>
                </section>
                <section className="card">
                  <div className="card-head"><h3>D’où vient le chiffre d’affaires</h3><span className="muted small">{dhs(t.A)}</span></div>
                  <table className="tbl"><tbody>
                    {d.produits.map((x) => <tr key={x.code}><td>{x.label}</td><td className="r">{n0(x.montant)}</td><td className="r muted">{t.A ? n0((x.montant / t.A) * 100) : 0} %</td></tr>)}
                  </tbody></table>
                  <div className="ops-sum" style={{ marginTop: 14, marginBottom: 0 }}>
                    <div><span className="muted">Résultat brut</span><b className={tone(t.brut)}>{dhs(t.brut)}</b></div>
                    <div><span className="muted">Impôt estimé</span><b>{dhs(t.impot)}</b></div>
                  </div>
                </section>
              </div>

              {d.operations.lignes > 0 && (
                <section className="card">
                  <div className="card-head"><h3><ClipboardList size={18} />Opérations et trajets</h3><span className="muted small">{n0(d.operations.lignes)} lignes · {n0(d.operations.km)} km · recettes {dhs(d.operations.produits)} · dépenses {dhs(d.operations.charges)}</span></div>
                  {d.operations.nbTrajets === 0 ? <p className="muted">Aucun trajet nommé : renseignez le champ « Voyage / trajet » pour comparer les trajets entre eux.</p> : (
                    <table className="tbl"><thead><tr><th>Trajet</th><th className="r">Lignes</th><th className="r">Recettes</th><th className="r">Dépenses</th><th className="r">Solde</th><th className="r">Km</th></tr></thead>
                      <tbody>{d.operations.meilleursTrajets.map((x) => <tr key={x.voyage}><td>{x.voyage}</td><td className="r">{x.lignes}</td><td className="r">{n0(x.produits)}</td><td className="r">{n0(x.charges)}</td><td className={`r ${tone(x.net)}`}><b>{n0(x.net)}</b></td><td className="r">{n0(x.km)}</td></tr>)}</tbody></table>
                  )}
                </section>
              )}

              <section className="card method">
                <div className="card-head"><h3>Méthode et hypothèses</h3></div>
                <ul className="muted small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
                  <li>Résultat brut = Produits (A) − Charges (B) ; Résultat net = Résultat brut − Impôt (T), comme dans la fiche « Situation camion ».</li>
                  <li>Impôt estimé : max ({n2(d.parametres.tauxIS)} % × résultat brut positif{d.parametres.cotisationMinimaleActive ? ` ; ${n2(d.parametres.cotisationMinimale)} % × produits` : ''}), sauf saisie manuelle sur une fiche. À faire valider par votre comptable.</li>
                  <li>{d.parametres.dateBascule ? `Mode opérations à partir de ${d.parametres.dateBascule} : recettes et charges variables viennent des opérations datées.` : 'Mode opérations non activé : montants de la fiche mensuelle et opérations datées sont additionnés.'}</li>
                  <li>Les mois sans fiche mensuelle n’ont pas de charges fixes : {d.fichesManquantes.total ? `${d.fichesManquantes.total} fiche(s) manquante(s) sur cette période.` : 'aucune fiche manquante sur cette période.'}</li>
                  <li>Les km comprennent ceux des fiches et ceux des opérations ; le coût au km = charges ÷ km.</li>
                </ul>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
