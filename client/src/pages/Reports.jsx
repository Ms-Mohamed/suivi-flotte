import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FileDown } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { api } from '../api.js';
import { Kpi, Plate, Spinner, Empty, useToast } from '../components.jsx';
import { dhs, n0, n2, monthShort, monthLong, compact, tone } from '../format.js';

export default function Reports() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [d, setD] = useState(null);
  const toast = useToast();
  useEffect(() => { setD(null); api(`/reports/annual?year=${year}`).then(setD).catch((e) => toast(e.message, 'err')); }, [year]); // eslint-disable-line

  const exportCsv = () => {
    const head = ['Camion', ...d.months.map(monthShort), 'Total'];
    const lines = d.rows.map((r) => [r.truck.immatriculation, ...r.cells.map((c) => (c ? c.net : '')), r.total.net]);
    lines.push(['FLOTTE', ...d.colTotals, d.grand]);
    const csv = [head, ...lines].map((l) => l.map((x) => String(x).replace('.', ',')).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `rapport-${year}.csv` }); a.click(); URL.revokeObjectURL(url);
  };

  const A = d?.rows.reduce((s, r) => s + r.total.A, 0) || 0, B = d?.rows.reduce((s, r) => s + r.total.B, 0) || 0;
  const maxAbs = d ? Math.max(1, ...d.rows.flatMap((r) => r.cells.map((c) => Math.abs(c?.net || 0)))) : 1;
  const best = d?.rows.length ? [...d.rows].sort((a, b) => b.total.net - a.total.net)[0] : null;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Rapport annuel</h1><p className="muted">Résultat net mensuel de chaque camion.</p></div>
        <div className="head-actions">
          <div className="monthpicker"><button className="icon-btn" onClick={() => setYear(year - 1)} aria-label="Année précédente"><ChevronLeft size={18} /></button><span className="monthpicker-label"><span>{year}</span></span><button className="icon-btn" onClick={() => setYear(year + 1)} aria-label="Année suivante"><ChevronRight size={18} /></button></div>
          <button className="btn" onClick={exportCsv} disabled={!d?.rows.length}><FileDown size={17} />CSV</button>
        </div>
      </div>
      {!d ? <div className="center"><Spinner /></div> : d.rows.length === 0 || (A === 0 && B === 0) ? <Empty title={`Aucune saisie en ${year}`}>Les résultats apparaîtront ici dès que vous aurez saisi des mois.</Empty> : (
        <>
          <section className="kpis">
            <Kpi label="Produits de l'année" value={dhs(A)} />
            <Kpi label="Charges de l'année" value={dhs(B)} />
            <Kpi accent label="Résultat net cumulé" value={dhs(d.grand)} tone={tone(d.grand)}><span>marge {A ? n2((d.grand / A) * 100) : '0,00'} %</span></Kpi>
            <Kpi label="Meilleur camion" value={best ? best.truck.immatriculation : '—'}><span>{best ? dhs(best.total.net) : ''}</span></Kpi>
          </section>
          <section className="card">
            <div className="card-head"><h3>Résultat net de la flotte par mois</h3></div>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={d.months.map((m, i) => ({ m, label: monthShort(m), net: d.colTotals[i] }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--mute)' }} />
                <YAxis tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--mute)' }} width={56} />
                <Tooltip cursor={{ fill: 'var(--hover)' }} formatter={(v) => dhs(v)} labelFormatter={(_, p) => (p?.[0] ? monthLong(p[0].payload.m) : '')} />
                <Bar isAnimationActive={false} dataKey="net" name="Résultat net" radius={[5, 5, 5, 5]} maxBarSize={34}>{d.colTotals.map((v, i) => <Cell key={i} fill={v >= 0 ? '#0e9f6e' : '#d92d20'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </section>
          <section className="card">
            <div className="card-head"><h3>Résultat net par camion et par mois (DHS)</h3></div>
            <div className="table-wrap">
              <table className="tbl heat">
                <thead><tr><th>Camion</th>{d.months.map((m) => <th key={m} className="r">{monthShort(m)}</th>)}<th className="r">Total</th></tr></thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.truck._id}>
                      <td><Plate>{r.truck.immatriculation}</Plate></td>
                      {r.cells.map((c, i) => {
                        const a = c ? Math.min(0.5, (Math.abs(c.net) / maxAbs) * 0.55 + 0.06) : 0;
                        return <td key={i} className={`r ${c ? tone(c.net) : 'muted'}`} style={c ? { background: `${c.net < 0 ? 'rgba(217,45,32,' : 'rgba(14,159,110,'}${a})` } : undefined}>{c ? (<Link to={`/camion/${r.truck._id}/${d.months[i]}`}>{n0(c.net)}</Link>) : '·'}</td>;
                      })}
                      <td className={`r ${tone(r.total.net)}`}><b>{n0(r.total.net)}</b></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>FLOTTE</td>{d.colTotals.map((v, i) => { const has = d.rows.some((r) => r.cells[i]); return <td key={i} className={`r ${has ? tone(v) : 'muted'}`}>{has ? n0(v) : '·'}</td>; })}<td className={`r ${tone(d.grand)}`}>{n0(d.grand)}</td></tr></tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
