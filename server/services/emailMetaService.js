import { firestore } from './firebaseAdmin.js';

// Per-tenant email metadata at users/{uid}/email_meta/{emailId}.
// We never modify Gmail itself; this layer is app-internal so folder moves
// and deletions are reversible and don't risk a user's real inbox.

function col(uid) {
  return firestore.collection('users').doc(uid).collection('email_meta');
}

export const EmailMetaService = {
  async listAll(uid) {
    const snap = await col(uid).get();
    const map = new Map();
    snap.docs.forEach(d => map.set(d.id, d.data()));
    return map;
  },

  async upsert(uid, emailId, patch) {
    const ref = col(uid).doc(emailId);
    await ref.set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true });
    const doc = await ref.get();
    return doc.exists ? doc.data() : null;
  },

  async setFolder(uid, emailId, folder) {
    return this.upsert(uid, emailId, { folder });
  },

  async setDeleted(uid, emailId, deleted = true) {
    return this.upsert(uid, emailId, { deleted });
  },

  async restore(uid, emailId) {
    return this.upsert(uid, emailId, { deleted: false });
  },
};
