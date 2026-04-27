import { firestore } from './firebaseAdmin.js';

function col(userId) {
  return firestore.collection('users').doc(userId).collection('notifications');
}

export const NotificationsService = {
  async list(userId) {
    const snap = await col(userId).orderBy('createdAt', 'desc').limit(50).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async unreadCount(userId) {
    const snap = await col(userId).where('read', '==', false).get();
    return snap.size;
  },

  async push(userId, { title, body, kind = 'info', link = null }) {
    const data = {
      title,
      body,
      kind,
      link,
      read: false,
      createdAt: new Date().toISOString(),
    };
    const ref = await col(userId).add(data);
    return { id: ref.id, ...data };
  },

  async markRead(userId, id) {
    const ref = col(userId).doc(id);
    const doc = await ref.get();
    if (!doc.exists) return null;
    await ref.update({ read: true });
    const fresh = await ref.get();
    return { id: fresh.id, ...fresh.data() };
  },

  async markAllRead(userId) {
    const snap = await col(userId).where('read', '==', false).get();
    if (snap.empty) return true;
    const batch = firestore.batch();
    snap.docs.forEach(d => batch.update(d.ref, { read: true }));
    await batch.commit();
    return true;
  },

  async remove(userId, id) {
    const ref = col(userId).doc(id);
    const doc = await ref.get();
    if (!doc.exists) return false;
    await ref.delete();
    return true;
  },

  async clear(userId) {
    const snap = await col(userId).get();
    if (snap.empty) return true;
    const batch = firestore.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    return true;
  },
};
