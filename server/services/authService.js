import crypto from 'crypto';
import { firestore } from './firebaseAdmin.js';

const usersCol = () => firestore.collection('users');
const sessionsCol = () => firestore.collection('sessions');

const DEFAULT_PREFS = {
  theme: 'dark',
  emailNotifications: true,
  pushNotifications: true,
  weeklyDigest: true,
  timezone: 'UTC',
  currency: 'USD', // 'USD' | 'INR'
};

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function emailKey(email) {
  return (email || '').trim().toLowerCase();
}

async function findUserByEmail(email) {
  const snap = await usersCol().where('email', '==', emailKey(email)).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function findUserById(id) {
  if (!id) return null;
  const doc = await usersCol().doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

async function createSession(userId) {
  const token = newToken();
  await sessionsCol().doc(token).set({
    userId,
    createdAt: new Date().toISOString(),
  });
  return token;
}

async function clearUserSessions(userId) {
  const snap = await sessionsCol().where('userId', '==', userId).get();
  const batch = firestore.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  if (!snap.empty) await batch.commit();
}

export const AuthService = {
  async signUp({ name, email, password }) {
    if (!name || !email || !password) {
      const err = new Error('Name, email and password are required'); err.status = 400; throw err;
    }
    if (password.length < 6) {
      const err = new Error('Password must be at least 6 characters'); err.status = 400; throw err;
    }
    const key = emailKey(email);
    const existing = await findUserByEmail(key);
    if (existing) {
      const err = new Error('An account with this email already exists. Please sign in.'); err.status = 409; throw err;
    }
    const salt = newSalt();
    const hash = hashPassword(password, salt);
    const userData = {
      name: name.trim(),
      email: key,
      salt,
      hash,
      provider: 'password',
      preferences: { ...DEFAULT_PREFS },
      createdAt: new Date().toISOString(),
    };
    const ref = await usersCol().add(userData);
    const user = { id: ref.id, ...userData };
    const token = await createSession(user.id);
    return { token, user: this.publicUser(user) };
  },

  async signIn({ email, password }) {
    if (!email || !password) {
      const err = new Error('Email and password are required'); err.status = 400; throw err;
    }
    const user = await findUserByEmail(email);
    if (!user) {
      const err = new Error('No account found for this email. Please sign up first.');
      err.status = 404; err.code = 'NOT_REGISTERED'; throw err;
    }
    if (!user.hash) {
      const err = new Error('This account signs in with Google. Use "Continue with Google".');
      err.status = 400; throw err;
    }
    const hash = hashPassword(password, user.salt);
    if (hash !== user.hash) {
      const err = new Error('Invalid email or password'); err.status = 401; throw err;
    }
    const token = await createSession(user.id);
    return { token, user: this.publicUser(user) };
  },

  async googleUpsert({ name, email, googleId }) {
    if (!email || !googleId) {
      const err = new Error('Google credentials are incomplete'); err.status = 400; throw err;
    }
    const key = emailKey(email);
    let user = await findUserByEmail(key);
    let isNew = false;
    if (!user) {
      const userData = {
        name: (name || key.split('@')[0]).trim(),
        email: key,
        salt: null,
        hash: null,
        googleId,
        provider: 'google',
        preferences: { ...DEFAULT_PREFS },
        createdAt: new Date().toISOString(),
      };
      const ref = await usersCol().add(userData);
      user = { id: ref.id, ...userData };
      isNew = true;
    } else if (!user.googleId) {
      await usersCol().doc(user.id).update({ googleId, provider: user.provider || 'google' });
      user.googleId = googleId;
      user.provider = user.provider || 'google';
    }
    const token = await createSession(user.id);
    return { token, user: this.publicUser(user), isNew };
  },

  async updateProfile(userId, { name, email }) {
    const u = await findUserById(userId);
    if (!u) { const err = new Error('User not found'); err.status = 404; throw err; }
    const patch = {};
    if (name && name.trim()) patch.name = name.trim();
    if (email && emailKey(email) !== u.email) {
      const newKey = emailKey(email);
      const conflict = await findUserByEmail(newKey);
      if (conflict && conflict.id !== u.id) {
        const err = new Error('That email is already in use'); err.status = 409; throw err;
      }
      patch.email = newKey;
    }
    if (Object.keys(patch).length) await usersCol().doc(u.id).update(patch);
    return this.publicUser({ ...u, ...patch });
  },

  async changePassword(userId, { currentPassword, newPassword }) {
    const u = await findUserById(userId);
    if (!u) { const err = new Error('User not found'); err.status = 404; throw err; }
    if (!u.hash || u.provider === 'google') {
      const err = new Error('This account signs in with Google — password cannot be changed here');
      err.status = 400; throw err;
    }
    if (!newPassword || newPassword.length < 6) {
      const err = new Error('New password must be at least 6 characters'); err.status = 400; throw err;
    }
    if (hashPassword(currentPassword || '', u.salt) !== u.hash) {
      const err = new Error('Current password is incorrect'); err.status = 401; throw err;
    }
    const salt = newSalt();
    const hash = hashPassword(newPassword, salt);
    await usersCol().doc(u.id).update({ salt, hash });
    await clearUserSessions(u.id);
    const token = await createSession(u.id);
    return { token, user: this.publicUser({ ...u, salt, hash }) };
  },

  async updatePreferences(userId, patch) {
    const u = await findUserById(userId);
    if (!u) { const err = new Error('User not found'); err.status = 404; throw err; }
    const merged = { ...DEFAULT_PREFS, ...(u.preferences || {}), ...(patch || {}) };
    await usersCol().doc(u.id).update({ preferences: merged });
    return merged;
  },

  async deleteAccount(userId) {
    const u = await findUserById(userId);
    if (!u) return false;
    await clearUserSessions(u.id);
    // Best-effort: cascade cleanup of per-user collections
    const subCols = ['projects', 'invoices', 'emails', 'alerts', 'notifications'];
    for (const c of subCols) {
      const snap = await usersCol().doc(u.id).collection(c).get();
      const batch = firestore.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      if (!snap.empty) await batch.commit();
    }
    await usersCol().doc(u.id).delete();
    return true;
  },

  async logout(token) {
    if (!token) return;
    await sessionsCol().doc(token).delete().catch(() => {});
  },

  async getUserByToken(token) {
    if (!token) return null;
    const doc = await sessionsCol().doc(token).get();
    if (!doc.exists) return null;
    const user = await findUserById(doc.data().userId);
    return user ? this.publicUser(user) : null;
  },

  publicUser(u) {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      provider: u.provider || 'password',
      preferences: u.preferences || { ...DEFAULT_PREFS },
      createdAt: u.createdAt,
    };
  },
};
