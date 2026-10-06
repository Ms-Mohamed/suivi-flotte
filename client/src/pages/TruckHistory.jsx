import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Plus } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Bar, Line, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { api } from '../api.js';
import { currentMonth } from '../../../shared/calc.js';
import { Kpi, Plate, Spinner, useToast } from '../components.jsx';
import { dhs, n0, monthLong, monthShort, compact, tone } from '../format.js';
import { OpsJournal } from './Operations.jsx';

/** Historique complet d'un camion : résultat mois par mois + journal de toutes ses opérations. */
export default function TruckHistory() {
  const { id } = useParams();
  const nav = useNavigate(); const toast = useToast();
  const [d, setD] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { api(`/trucks/${id}/historique`).then(setD).catch((e) => { toast(e.message, 'err'); nav('/camions'); }); }, [id, tick]); // eslint-disable-line
  if (!d) return <div className="page"><div className="center"><Spinner /></div></div>;
  const { truck, mois, resume } = d;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/camions" className="back"><ArrowLeft size={16} />Camions</Link>
          <h1 className="with-plate"><Plate>{truck.immatriculation}</Plate><span>Historique</span></h1>
          <p className="muted">{[truck.marque, truck.modele].filter(Boolean).join(' ')}{truck.chauffeur ? ` · Chauffeur : ${truck.chauffeur}` : ''}</p>
        </div>
        <div className="head-actions"><Link className="btn" to={`/camion/${id}/${currentMonth()}`}><FileText size={17} />Situation du mois</Link></div>
      </div>
      {mois.length === 0 ? <div className="alert info">Aucune donnée pour ce camion : saisissez un mois ou une opération.</div> : (
        <>
          <section className="kpis" style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
            <Kpi accent label="Résultat net cumulé" value={dhs(resume.total)}><span>{resume.nbMois} mois</span></Kpi>
            <Kpi label="Moyenne par mois" value={dhs(resume.moyenne)} tone={tone(resume.moyenne)} />
            <Kpi label="Meilleur mois" value={dhs(resume.meilleur.net)} tone={tone(resume.meilleur.net)}><span>{monthLong(resume.meilleur.month)}</span></Kpi>
            <Kpi label="Pire mois" value={dhs(resume.pire.net)} tone={tone(resume.pire.net)}><span>{monthLong(resume.pire.month)}</span></Kpi>
          </section>
          <section className="card">
            <div className="card-head"><h3>Résultat net mois par mois et cumul</h3></div>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={mois.map((m) => ({ ...m, label: monthShort(m.month) }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--mute)' }} />
                <YAxis tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--mute)' }} width={56} />
                <Tooltip cursor={{ fill: 'var(--hover)' }} formatter={(v) => dhs(v)} labelFormatter={(_, p) => (p?.[0] ? monthLong(p[0].payload.month) : '')} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar isAnimationActive={false} dataKey="net" name="Résultat net du mois" radius={[5, 5, 5, 5]} maxBarSize={34}>{mois.map((m, i) => <Cell key={i} fill={m.net >= 0 ? '#0e9f6e' : '#d92d20'} />)}</Bar>
                <Line isAnimationActive={false} type="monotone" dataKey="cumul" name="Cumul" stroke="#2f5bea" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </section>
          <section className="card table-wrap" style={{ padding: 8 }}>
            <table className="tbl">
              <thead><tr><th>Mois</th><th className="r">Produits</th><th className="r">Charges</th><th className="r">Résultat net</th><th className="r">Cumul</th><th className="r">Lignes d’opérations</th><th /></tr></thead>
              <tbody>
                {[...mois].reverse().map((m) => (
                  <tr key={m.month} className="click" onClick={() => nav(`/camion/${id}/${m.month}`)}>
                    <td>{monthLong(m.month)}{!m.saisi && <span className="pill warn" style={{ marginLeft: 8 }}>fiche du mois non saisie</span>}</td>
                    <td className="r">{n0(m.A)}</td><td className="r">{n0(m.B)}</td><td className={`r ${tone(m.net)}`}><b>{n0(m.net)}</b></td>
                    <td className={`r ${tone(m.cumul)}`}>{n0(m.cumul)}</td><td className="r">{m.nbOps || ''}</td><td className="r"><span className="muted">Ouvrir →</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
      <section className="card">
        <div className="card-head"><h3>Toutes les opérations de ce camion</h3></div>
        <OpsJournal truckId={id} initial={{ from: '' }} onChanged={() => setTick((t) => t + 1)} />
      </section>
    </div>
  );
}
