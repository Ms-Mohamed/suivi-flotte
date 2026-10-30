import { requireRole } from '../auth.js';
import { wrap, plain, isId, httpError, esc, zIdOpt } from './util.js';
import { validDate } from '../ops.js';

/**
 * CRUD générique : GET liste (filtres, recherche, dates, pagination) / GET un / POST / PUT / DELETE.
 * cfg : { postFilter(docs, query), afterDelete(doc, req), path, Model, body (zod), populate, search[], filters[], dateField, sort, write: [...rôles] | 'admin', read: 'admin' | undefined,
 *         view(doc, ctx), pre(body, req, existing), post(doc, req, existing), lock(doc) -> message|null, canDelete(doc) -> message|null, onDelete(doc, req),
 *         summary(docs, query) -> objet fusionné dans la réponse (extra), query(q) -> filtre mongo supplémentaire }
 */
export function mountCrud(r, cfg) {
  const { path, Model, body, populate = [], search = [], filters = [], dateField, sort = { createdAt: -1 }, view = (d) => d } = cfg;
  const guardW = cfg.write === 'admin' ? requireRole() : requireRole(...(cfg.write || ['saisie']));
  const guardR = cfg.read === 'admin' ? [requireRole()] : [];
  const find = (f) => { let q = Model.find(f).sort(sort); for (const p of populate) q = q.populate(p); return q.lean(); };

  const filterFrom = (q) => {
    const f = { ...(cfg.query ? cfg.query(q) : {}) };
    for (const k of filters) {
      if (q[k] === undefined || q[k] === '') continue;
      if (k.toLowerCase().includes('truck') || cfg.refFilters?.includes(k)) { if (!isId(q[k])) throw httpError(400, 'Filtre invalide'); }
      f[k] = q[k] === 'true' ? true : q[k] === 'false' ? false : q[k];
    }
    if (dateField && (q.from || q.to)) {
      for (const d of [q.from, q.to]) if (d && !validDate(d)) throw httpError(400, 'Date invalide (AAAA-MM-JJ)');
      f[dateField] = {}; if (q.from) f[dateField].$gte = q.from; if (q.to) f[dateField].$lte = q.to;
    }
    return f;
  };
  const flat = (d) => search.map((k) => k.split('.').reduce((o, p) => o?.[p], d)).filter((x) => x != null).join(' ').toLowerCase();

  r.get(path, ...guardR, wrap(async (req, res) => {
    let docs = await find(filterFrom(req.query));
    if (cfg.postFilter) docs = await cfg.postFilter(docs, req.query);
    if (req.query.q) { const t = String(req.query.q).toLowerCase(); docs = docs.filter((d) => flat(d).includes(t)); }
    const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 500)); const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const extra = cfg.summary ? await cfg.summary(docs, req.query) : {};
    const slice = docs.slice((page - 1) * limit, page * limit);
    res.json({ items: await Promise.all(slice.map((d) => view(d, req))), total: docs.length, page, limit, ...extra });
  }));
  r.get(`${path}/:id`, ...guardR, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(400, 'Identifiant invalide');
    const [d] = await find({ _id: req.params.id });
    return d ? res.json(await view(d, req)) : res.status(404).json({ error: 'Introuvable' });
  }));
  r.post(path, guardW, wrap(async (req, res) => {
    const b = body.parse(req.body);
    if (cfg.pre) await cfg.pre(b, req, null);
    const doc = await Model.create(b);
    if (cfg.post) await cfg.post(doc, req, null);
    const [d] = await find({ _id: doc._id });
    res.status(201).json(await view(d, req));
  }));
  r.put(`${path}/:id`, guardW, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(400, 'Identifiant invalide');
    const doc = await Model.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Introuvable' });
    const lock = await cfg.lock?.(doc); if (lock) throw httpError(409, lock);
    const b = body.parse(req.body);
    const before = plain(doc);
    if (cfg.pre) await cfg.pre(b, req, doc);
    doc.set(b); await doc.save();
    if (cfg.post) await cfg.post(doc, req, before);
    const [d] = await find({ _id: doc._id });
    res.json(await view(d, req));
  }));
  r.delete(`${path}/:id`, guardW, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(400, 'Identifiant invalide');
    const doc = await Model.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Introuvable' });
    const msg = await cfg.canDelete?.(doc); if (msg) throw httpError(409, msg);
    if (cfg.onDelete) await cfg.onDelete(doc, req);
    await doc.deleteOne();
    if (cfg.afterDelete) await cfg.afterDelete(doc, req);
    res.json({ ok: true });
  }));
}
export { zIdOpt };
