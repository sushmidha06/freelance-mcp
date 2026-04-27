import { firestore } from './firebaseAdmin.js';

function userCol(userId, name) {
  return firestore.collection('users').doc(userId).collection(name);
}

export class DBService {
  static async getCollection(collectionName, userId) {
    const snap = await userCol(userId, collectionName).orderBy('createdAt', 'desc').get().catch(async () => {
      // Fallback if docs predate createdAt field
      return userCol(userId, collectionName).get();
    });
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  static async addToCollection(collectionName, userId, item) {
    const { id, ...payload } = item;
    const data = { ...payload, createdAt: payload.createdAt || new Date().toISOString() };
    if (id) {
      await userCol(userId, collectionName).doc(id).set(data);
      return { id, ...data };
    }
    const ref = await userCol(userId, collectionName).add(data);
    return { id: ref.id, ...data };
  }

  static async removeFromCollection(collectionName, userId, itemId) {
    const ref = userCol(userId, collectionName).doc(itemId);
    const doc = await ref.get();
    if (!doc.exists) return false;
    await ref.delete();
    return true;
  }

  static async updateInCollection(collectionName, userId, itemId, patch) {
    const ref = userCol(userId, collectionName).doc(itemId);
    const doc = await ref.get();
    if (!doc.exists) return null;
    await ref.update(patch);
    const updated = await ref.get();
    return { id: updated.id, ...updated.data() };
  }

  static async getDashboardStats(userId) {
    const [projects, invoices, alerts] = await Promise.all([
      this.getCollection('projects', userId),
      this.getCollection('invoices', userId),
      this.getCollection('alerts',   userId),
    ]);

    const revenue = invoices.filter(i => i.status === 'Paid').reduce((s, i) => s + (i.amount || 0), 0);
    const pending = invoices.filter(i => i.status !== 'Paid').length;
    const commits = projects.reduce((s, p) => s + (p.commits || 0), 0);

    return {
      stats: [
        { label: 'Monthly Revenue',  kind: 'currency', amount: revenue, value: revenue.toString(), change: revenue ? 'Updated' : 'No data', up: revenue > 0 },
        { label: 'Active Projects',  value: projects.length.toString(),     change: projects.length ? 'Real-time' : 'No data', up: projects.length > 0 },
        { label: 'Pending Invoices', value: pending.toString(),             change: pending ? 'Action required' : 'All caught up', up: pending === 0 },
        { label: 'Commits (7d)',     value: commits.toString(),             change: commits ? 'Updated' : 'No data', up: commits > 0 },
      ],
      alerts,
    };
  }
}
