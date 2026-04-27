import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

let app;

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Support base64 to avoid newline issues on hosting env
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT must be JSON or base64-encoded JSON');
    }
  }
}

if (!admin.apps.length) {
  const svc = parseServiceAccount();
  if (svc) {
    app = admin.initializeApp({
      credential: admin.credential.cert(svc),
      projectId: svc.project_id,
    });
  } else {
    // Local fallback — relies on GOOGLE_APPLICATION_CREDENTIALS or firebase CLI auth
    app = admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || 'freelance-mcp-c3b42',
    });
  }
} else {
  app = admin.app();
}

export const firestore = admin.firestore();
export const adminAuth = admin.auth();
export { admin };
export default app;
