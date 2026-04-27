import { firestore } from './firebaseAdmin.js';

// Per-tenant expenses at users/{uid}/expenses/{id}.
// Schema: { amount, currency, date, vendor, category, projectId, projectClient, source, notes, createdAt }
//   - projectId is optional. If set, expense rolls up into that project's `spent`.
//   - source: 'manual' | 'email:<emailId>' (Phase C)
//
// Categories are open-ended strings; we ship a default list the UI can suggest.

export const EXPENSE_CATEGORIES = [
  'Software',
  'Hardware',
  'Hosting & infra',
  'Subcontractor',
  'Travel',
  'Meals',
  'Office',
  'Marketing',
  'Taxes & fees',
  'Other',
];

function col(uid) {
  return firestore.collection('users').doc(uid).collection('expenses');
}

function normalise(input) {
  const out = { ...input };
  if (out.amount != null) out.amount = Number(out.amount);
  if (typeof out.vendor === 'string') out.vendor = out.vendor.trim();
  if (typeof out.notes === 'string') out.notes = out.notes.trim();
  if (typeof out.category === 'string') out.category = out.category.trim();
  if (out.projectId === '') out.projectId = null;
  return out;
}

export const ExpensesService = {
  async list(uid, { projectId } = {}) {
    let q = col(uid);
    if (projectId) q = q.where('projectId', '==', projectId);
    // Order by date desc; fall back to createdAt if some docs are missing date.
    const snap = await q.orderBy('date', 'desc').get().catch(async () => col(uid).get());
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async create(uid, data) {
    const item = normalise({
      ...data,
      createdAt: new Date().toISOString(),
      source: data.source || 'manual',
    });
    if (!item.amount || item.amount <= 0) {
      const err = new Error('amount is required and must be > 0'); err.status = 400; throw err;
    }
    if (!item.vendor) { const err = new Error('vendor is required'); err.status = 400; throw err; }
    if (!item.date) item.date = new Date().toISOString().slice(0, 10);
    const ref = await col(uid).add(item);
    return { id: ref.id, ...item };
  },

  async update(uid, id, patch) {
    const ref = col(uid).doc(id);
    const doc = await ref.get();
    if (!doc.exists) return null;
    await ref.update(normalise(patch));
    const updated = await ref.get();
    return { id: updated.id, ...updated.data() };
  },

  async remove(uid, id) {
    const ref = col(uid).doc(id);
    const doc = await ref.get();
    if (!doc.exists) return false;
    await ref.delete();
    return true;
  },

  // Returns { projectId -> totalSpent } for use when enriching projects.
  async sumByProject(uid) {
    const snap = await col(uid).get();
    const out = {};
    snap.docs.forEach(d => {
      const data = d.data();
      const pid = data.projectId;
      if (!pid) return;
      out[pid] = (out[pid] || 0) + Number(data.amount || 0);
    });
    return out;
  },
};
