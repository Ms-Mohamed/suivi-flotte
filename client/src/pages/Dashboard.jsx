import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, AlertTriangle, Truck as TruckIcon } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Area, Line, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie } from 'recharts';
import { api, download } from '../api.js';
import { PLAN, currentMonth, prevMonth } from '../../../shared/calc.js';
import { Kpi, Delta, MonthPicker, Plate, Empty, Spinner, useToast } from '../components.jsx';
import { dhs, n0, n2, monthLong, monthShort, compact, tone } from '../format.js';

const C = { brand: '#2f5bea', teal: '#12a594', amber: '#f5a524', pos: '#0e9f6e', neg: '#d92d20', grid: 'var(--line)' };
const GROUPS = { variables: { name: 'Variables', color: C.brand }, fixes: { name: 'Fixes', color: C.teal }, amortissements: { name: 'Amortissements', color: C.amber } };
const LABEL = Object.fromEntries([...PLAN.produits, ...PLAN.charges.flatMap((g) => g.comptes)].map((c) => [c.code, c.label]));

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonth());
  const [d, setD] = useState(null);
  const [auto, setAuto] = useState(true);
  const nav = useNavigate(); const toast = useToast();

  useEffect(() => {
    let live = true; setD(null);
    api(`/reports/dashboard?month=${month}`).then((r) => {
      if (!live) return;
      if (auto && month === currentMonth() && r.nbSaisis === 0) { setAuto(false); setMonth(prevMonth(month)); return; }
      setAuto(false); setD(r);
    }).catch((e) => toast(e.message, 'err'));
    return () => { live = false; };
  }, [month]); // eslint-disable-line

  const rows = useMemo(() => (d ? [...d.trucks].sort((a, b) => (b.saisi - a.saisi) || b.calc.net - a.calc.net) : []), [d]);
  const maxAbs = useMemo(() => Math.max(1, ...rows.map((r) => Math.abs(r.calc.net))), [rows]);

  if (!d) return <div className="page"><PageHead month={month} setMonth={setMonth} /><div className="center"><Spinner /></div></div>;
  const t = d.totals, p = d.previousTotals;
  const marge = t.A ? (t.net / t.A) * 100 : 0, pMarge = p.A ? (p.net / p.A) * 100 : 0;
  const missing = d.trucks.filter((x) => !x.saisi);
  const losers = d.trucks.filter((x) => x.saisi && x.calc.net < 0);
  const structure = ['variables', 'fixes', 'amortissements'].map((k) => ({ key: k, name: GROUPS[k].name, value: t[k], color: GROUPS[k].color })).filter((x) => x.value > 0);
  const topCharges = PLAN.charges.flatMap((g) => g.comptes).map((c) => ({ label: c.label, v: d.parCompte[c.code] })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 5);
  const trend = d.trend.map((x) => ({ ...x, label: monthShort(x.month) }));
  const hasData = d.nbSaisis > 0;

  return (
    <div className="page">
      <PageHead month={month} setMonth={setMonth} onExport={() => download(`/export/month/${month}`, `flotte-${month}.xlsx`).catch((e) => toast(e.message, 'err'))} />
      {d.nbCamions === 0 && <Empty icon={TruckIcon} title="Aucun camion pour l'instant">Ajoutez votre premier camion pour commencer le suivi. <Link to="/camions">Ajouter un camion →</Link></Empty>}
      {d.nbCamions > 0 && (
        <>
          {(missing.length > 0 || losers.length > 0) && (
            <div className="alerts">
              {missing.length > 0 && <div className="alert warn"><AlertTriangle size={18} /><div><strong>{missing.length} camion{missing.length > 1 ? 's' : ''} sans saisie</strong> pour {monthLong(month).toLowerCase()} : {missing.map((m, i) => <React.Fragment key={m.truck._id}>{i > 0 && ', '}<Link to={`/camion/${m.truck._id}/${month}`}>{m.truck.immatriculation}</Link></React.Fragment>)}</div></div>}
              {losers.length > 0 && <div className="alert bad"><AlertTriangle size={18} /><div><strong>{losers.length} camion{losers.length > 1 ? 's' : ''} en perte</strong> : {losers.map((m, i) => <React.Fragment key={m.truck._id}>{i > 0 && ', '}<Link to={`/camion/${m.truck._id}/${month}`}>{m.truck.immatriculation} ({dhs(m.calc.net)})</Link></React.Fragment>)}</div></div>}
            </div>
          )}
          <section className="kpis">
            <Kpi label="Produits (A)" value={dhs(t.A)}><Delta current={t.A} previous={p.A} /><span>vs {monthShort(d.previousMonth)}</span></Kpi>
            <Kpi label="Charges (B)" value={dhs(t.B)}><Delta current={t.B} previous={p.B} invert /><span>vs {monthShort(d.previousMonth)}</span></Kpi>
            <Kpi accent label="Résultat net" value={dhs(t.net)} tone={tone(t.net)}><Delta current={t.net} previous={p.net} /><span>brut {dhs(t.brut)}</span></Kpi>
            <Kpi label="Marge nette" value={`${n2(marge)} %`} tone={tone(marge)}><Delta current={marge} previous={pMarge} unit="pts" /></Kpi>
            <Kpi label="Coût / km" value={t.km ? `${n2(t.B / t.km)} DHS` : '—'}><span>{n0(t.km)} km parcourus</span></Kpi>
          </section>

          {hasData && (
            <section className="grid-3-2">
              <div className="card">
                <div className="card-head"><h3>Évolution sur 12 mois</h3><div className="legend"><i style={{ background: C.brand }} />Produits<i style={{ background: C.amber }} />Charges<i style={{ background: C.pos }} />Résultat net (axe de droite)</div></div>
                <ResponsiveContainer width="100%" height={270}>
                  <ComposedChart data={trend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <defs><linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.brand} stopOpacity={0.28} /><stop offset="100%" stopColor={C.brand} stopOpacity={0.02} /></linearGradient></defs>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--mute)' }} />
                    <YAxis yAxisId="l" tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--mute)' }} width={56} />
                    <YAxis yAxisId="r" orientation="right" tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: C.pos }} width={48} />
                    <Tooltip content={<TrendTip />} cursor={{ fill: 'var(--hover)' }} />
                    <Area isAnimationActive={false} yAxisId="l" type="monotone" dataKey="A" stroke={C.brand} strokeWidth={2.2} fill="url(#gA)" />
                    <Line isAnimationActive={false} yAxisId="l" type="monotone" dataKey="B" stroke={C.amber} strokeWidth={2.2} dot={false} />
                    <Bar isAnimationActive={false} yAxisId="r" dataKey="net" barSize={14} radius={[4, 4, 4, 4]}>{trend.map((x, i) => <Cell key={i} fill={x.net >= 0 ? C.pos : C.neg} fillOpacity={x.month === month ? 1 : 0.55} />)}</Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="card">
                <div className="card-head"><h3>Structure des charges</h3></div>
                <div className="donut-wrap">
                  <ResponsiveContainer width={170} height={170}>
                    <PieChart><Pie isAnimationActive={false} data={structure} dataKey="value" innerRadius={56} outerRadius={80} paddingAngle={2} stroke="none">{structure.map((s) => <Cell key={s.key} fill={s.color} />)}</Pie></PieChart>
                  </ResponsiveContainer>
                  <ul className="donut-legend">{structure.map((s) => <li key={s.key}><i style={{ background: s.color }} /><span>{s.name}</span><b>{n0((s.value / t.B) * 100)} %</b><small>{dhs(s.value)}</small></li>)}</ul>
                </div>
                <h4 className="mini-title">Premiers postes de charges</h4>
                <ul className="bars">{topCharges.map((c) => <li key={c.label}><span>{c.label}</span><div><i style={{ width: `${(c.v / topCharges[0].v) * 100}%` }} /></div><b>{n0(c.v)}</b></li>)}</ul>
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-head"><h3>Situation par camion — {monthLong(month)}</h3><span className="muted">{d.nbSaisis}/{d.nbCamions} saisis</span></div>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Camion</th><th className="r">Km</th><th className="r">Produits</th><th className="r">Charges</th><th className="r">Résultat brut</th><th style={{ minWidth: 190 }}>Résultat net</th><th className="r">Marge</th><th className="r">Coût/km</th></tr></thead>
                <tbody>
                  {rows.map(({ truck, calc, saisi }) => (
                    <tr key={truck._id} className="click" tabIndex={0} onClick={() => nav(`/camion/${truck._id}/${month}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/camion/${truck._id}/${month}`)}>
                      <td><Plate>{truck.immatriculation}</Plate><div className="sub">{[truck.marque, truck.modele].filter(Boolean).join(' ')}{truck.chauffeur ? ` · ${truck.chauffeur}` : ''}</div></td>
                      {saisi ? (<>
                        <td className="r">{n0(calc.km)}</td><td className="r">{n0(calc.A)}</td><td className="r">{n0(calc.B)}</td>
                        <td className={`r ${tone(calc.brut)}`}>{n0(calc.brut)}</td>
                        <td><div className="netbar"><div className="track"><i className={calc.net < 0 ? 'neg' : 'pos'} style={{ width: `${(Math.abs(calc.net) / maxAbs) * 100}%` }} /></div><b className={tone(calc.net)}>{n0(calc.net)}</b></div></td>
                        <td className="r"><span className={`pill ${calc.net < 0 ? 'neg' : 'pos'}`}>{n2(calc.marge)} %</span></td>
                        <td className="r">{calc.km ? n2(calc.coutKm) : '—'}</td>
                      </>) : <td colSpan={7}><span className="pill warn">Non saisi — cliquez pour saisir</span></td>}
                    </tr>
                  ))}
                </tbody>
                {hasData && <tfoot><tr><td>TOTAL FLOTTE</td><td className="r">{n0(t.km)}</td><td className="r">{n0(t.A)}</td><td className="r">{n0(t.B)}</td><td className={`r ${tone(t.brut)}`}>{n0(t.brut)}</td><td className={tone(t.net)}><b>{n0(t.net)}</b></td><td className="r">{n2(marge)} %</td><td className="r">{t.km ? n2(t.B / t.km) : '—'}</td></tr></tfoot>}
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function PageHead({ month, setMonth, onExport }) {
  return (
    <div className="page-head">
      <div><h1>Tableau de bord</h1><p className="muted">Rentabilité de la flotte, mois par mois.</p></div>
      <div className="head-actions"><MonthPicker value={month} onChange={setMonth} />{onExport && <button className="btn" onClick={onExport}><Download size={17} />Excel</button>}</div>
    </div>
  );
}
function TrendTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const x = payload[0].payload;
  return <div className="tip"><b>{monthLong(x.month)}</b><div><i style={{ background: C.brand }} />Produits <span>{dhs(x.A)}</span></div><div><i style={{ background: C.amber }} />Charges <span>{dhs(x.B)}</span></div><div><i style={{ background: x.net >= 0 ? C.pos : C.neg }} />Net <span>{dhs(x.net)}</span></div></div>;
}
