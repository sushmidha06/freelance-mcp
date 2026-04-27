import jwt from 'jsonwebtoken';

function getSecret() {
  const s = process.env.JWT_SHARED_SECRET;
  if (!s) throw new Error('JWT_SHARED_SECRET is not set');
  return s;
}

// Short-lived JWT used to authorise the Python AI service to act on behalf of a user.
export function signServiceToken(payload, ttlSeconds = 300) {
  return jwt.sign(payload, getSecret(), { algorithm: 'HS256', expiresIn: ttlSeconds });
}

export function verifyServiceToken(token) {
  try {
    return jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}
