import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Info } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Kpi, Delta, Plate, Spinner, Empty, useToast } from '../components.jsx';
import { dhs, n0, compact, tone } from '../format.js';
import OperationForm, { todayStr } from './OperationForm.jsx';

const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const short = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
const NB = 8;

export default function Weeks() {
  const { user } = useApp();
  const toast = useToast();
  const [date, setDate] = useState(todayStr());
  const [d, setD] = useState(null);
  const [form, setForm] = useState(false);
  const [trucks, setTrucks] = useState([]);
  const load = () => api(`/reports/semaines?date=${date}&nb=${NB}`).then(setD).catch((e) => toast(e.message, 'err'));
  useEffect(() => { setD(null); load(); }, [date]); // eslint-disable-line
  useEffect(() => { api('/trucks').then(setTrucks).catch(() => {}); }, []);

  const cur = d?.flotte[NB - 1], prev = d?.flotte[NB - 2];
  const maxAbs = d ? Math.max(1, ...d.rows.flatMap((r) => r.cells.map((c) => Math.abs(c?.net || 0)))) : 1;
  const ranking = d ? [...d.courante].sort((a, b) => b.net - a.net) : [];
  const maxBar = Math.max(1, ...ranking.map((x) => Math.abs(x.net)));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Semaines</h1><p className="muted">Recettes et dépenses des voyages, semaine par semaine (du lundi au dimanche).</p></div>
        <div className="head-actions">
          <div className="monthpicker week-nav">
            <button className="icon-btn" onClick={() => setDate(addDays(date, -7))} aria-label="Semaine précédente"><ChevronLeft size={18} /></button>
            <strong>{d ? `Semaine ${d.semaine.semaine} · ${short(d.semaine.debut)} – ${short(d.semaine.fin)}${d.semaine.debut <= todayStr() && todayStr() <= d.semaine.fin ? ' (en cours)' : ''}` : '…'}</strong>
            <button className="icon-btn" onClick={() => setDate(addDays(date, 7))} aria-label="Semaine suivante"><ChevronRight size={18} /></button>
            <button className="chip-btn" onClick={() => setDate(todayStr())}>Cette semaine</button>
          </div>
          {user.role !== 'lecture' && <button className="btn primary" onClick={() => setForm(true)}><Plus size={18} />Nouvelle opération</button>}
        </div>
      </div>
      <div className="alert info"><Info size={18} /><div>Cette page ne compte que les <strong>opérations saisies avec une date</strong> (recettes et dépenses de chaque voyage). Les charges fixes (crédit-bail, salaires, assurances…) restent mensuelles et n’apparaissent que dans la fiche du mois. Le « solde » n’est donc pas le résultat net.</div></div>
      {!d ? <div className="center"><Spinner /></div> : cur.n === 0 && d.flotte.every((w) => w.n === 0) ? (
        <Empty title="Aucune opération sur ces 8 semaines">Saisissez vos voyages avec « Nouvelle opération » pour alimenter ce tableau de bord.</Empty>
      ) : (
        <>
          <section className="kpis" style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
            <Kpi label="Recettes de la semaine" value={dhs(cur.A)}><Delta current={cur.A} previous={prev.A} /></Kpi>
            <Kpi label="Dépenses de la semaine" value={dhs(cur.B)}><Delta current={cur.B} previous={prev.B} invert /></Kpi>
            <Kpi accent label="Solde des voyages" value={dhs(cur.net)}><Delta current={cur.net} previous={prev.net} /></Kpi>
            <Kpi label="Km · lignes saisies" value={`${n0(cur.km)} km`}><span>{cur.n} ligne{cur.n > 1 ? 's' : ''}</span></Kpi>
          </section>
          <div className="grid-3-2">
            <section className="card">
              <div className="card-head"><h3>Flotte, 8 dernières semaines</h3></div>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={d.flotte.map((w) => ({ ...w, label: `S${w.semaine}` }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--mute)' }} />
                  <YAxis tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--mute)' }} width={56} />
                  <Tooltip cursor={{ fill: 'var(--hover)' }} formatter={(v) => dhs(v)} labelFormatter={(_, p) => (p?.[0] ? `Semaine ${p[0].payload.semaine} · ${short(p[0].payload.debut)}` : '')} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar isAnimationActive={false} dataKey="A" name="Recettes" fill="#0e9f6e" radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar isAnimationActive={false} dataKey="B" name="Dépenses" fill="#f5a524" radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </section>
            <section className="card">
              <div className="card-head"><h3>Camions cette semaine</h3></div>
              <div className="rank">
                {ranking.map((x) => (
                  <div key={x.truck._id} className="bar-cell" style={{ justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                    <Link to={`/camion/${x.truck._id}`}><Plate>{x.truck.immatriculation}</Plate></Link>
                    {x.n ? <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
                      <i className={x.net < 0 ? 'n' : ''} style={{ width: `${Math.max(4, (Math.abs(x.net) / maxBar) * 90)}px` }} />
                      <b className={tone(x.net)}>{n0(x.net)}</b></span> : <span className="muted small">aucune opération</span>}
                  </div>
                ))}
              </div>
            </section>
          </div>
          <section className="card">
            <div className="card-head"><h3>Solde des voyages par camion et par semaine (DHS)</h3></div>
            <div className="table-wrap">
              <table className="tbl heat">
                <thead><tr><th>Camion</th>{d.flotte.map((w) => <th key={w.debut} className="r" title={`Semaine ${w.semaine}`}>{short(w.debut)}</th>)}</tr></thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.truck._id}>
                      <td><Link to={`/camion/${r.truck._id}`}><Plate>{r.truck.immatriculation}</Plate></Link></td>
                      {r.cells.map((c, i) => {
                        const a = c ? Math.min(0.5, (Math.abs(c.net) / maxAbs) * 0.55 + 0.06) : 0;
                        return <td key={i} className={`r ${c ? tone(c.net) : 'muted'}`} style={c ? { background: `${c.net < 0 ? 'rgba(217,45,32,' : 'rgba(14,159,110,'}${a})` } : undefined}>
                          {c ? <Link to={`/operations?truck=${r.truck._id}&from=${d.starts[i]}&to=${addDays(d.starts[i], 6)}`}>{n0(c.net)}</Link> : '·'}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>FLOTTE</td>{d.flotte.map((w) => <td key={w.debut} className={`r ${w.n ? tone(w.net) : 'muted'}`}>{w.n ? n0(w.net) : '·'}</td>)}</tr></tfoot>
              </table>
            </div>
          </section>
        </>
      )}
      {form && <OperationForm trucks={trucks} initial={{ date: date > todayStr() ? todayStr() : date }} onClose={() => setForm(false)} onSaved={load} />}
    </div>
  );
}
