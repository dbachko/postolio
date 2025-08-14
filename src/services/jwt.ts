import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-development'

export interface JWTPayload {
  id: string
  email: string
}

export function signJWT(payload: JWTPayload): string {
  // JWT automatically adds 'iat' (issued at) claim
  return jwt.sign(payload, JWT_SECRET, { 
    expiresIn: '7d'
  })
}

export function verifyJWT(token: string): JWTPayload {
  // Add clock tolerance to handle minor time differences between client and server
  return jwt.verify(token, JWT_SECRET, {
    clockTolerance: 60 // Allow 60 seconds of clock skew
  }) as JWTPayload
}