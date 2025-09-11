import jwt from 'jsonwebtoken';

// Ensure JWT_SECRET is always set in production
let JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  // Development-only fallback with clear warning
  console.warn(
    '⚠️  JWT_SECRET not set. Using development-only fallback. NEVER use this in production!'
  );
  JWT_SECRET = 'development-only-secret-do-not-use-in-production';
}

export interface JWTPayload {
  id: string;
  email: string;
}

export function signJWT(payload: JWTPayload, expiresIn: string = '7d'): string {
  // JWT automatically adds 'iat' (issued at) claim
  return jwt.sign(payload, JWT_SECRET!, {
    expiresIn,
  } as jwt.SignOptions);
}

export function verifyJWT(token: string): JWTPayload {
  // Add clock tolerance to handle minor time differences between client and server
  const decoded = jwt.verify(token, JWT_SECRET!, {
    clockTolerance: 60, // Allow 60 seconds of clock skew
  });

  // Ensure the decoded token has the required properties
  if (typeof decoded === 'object' && decoded !== null && 'id' in decoded && 'email' in decoded) {
    return decoded as JWTPayload;
  }

  throw new Error('Invalid JWT payload structure');
}
