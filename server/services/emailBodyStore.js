// Persists fetched email bodies in users/{uid}/email_bodies/{emailId} so the
// RAG layer can include them across requests without re-fetching from IMAP.
//
// Schema: { from, fromAddress, subject, date, body, syncedAt }

import { firestore } from './firebaseAdmin.js';

function col(uid) {
  return firestore.collection('users').doc(uid).collection('email_bodies');
}

export const EmailBodyStore = {
  async upsertMany(uid, emails) {
    if (!emails || emails.length === 0) return 0;
    const now = new Date().toISOString();
    // Firestore batch limit is 500. We're well under that with limit 100.
    const batch = firestore.batch();
    for (const e of emails) {
      const id = `g_${e.uid}`;
      batch.set(col(uid).doc(id), { ...e, syncedAt: now }, { merge: true });
    }
    await batch.commit();
    return emails.length;
  },

  async list(uid, { limit = 200 } = {}) {
    const snap = await col(uid).orderBy('date', 'desc').limit(limit).get().catch(async () => col(uid).get());
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async count(uid) {
    const snap = await col(uid).get();
    return snap.size;
  },

  async lastSyncedAt(uid) {
    const snap = await col(uid).orderBy('syncedAt', 'desc').limit(1).get().catch(() => null);
    if (!snap || snap.empty) return null;
    return snap.docs[0].data()?.syncedAt || null;
  },
};
