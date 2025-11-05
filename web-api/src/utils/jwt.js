import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET_KEY;
const TOKEN_EXPIRE_DAYS = parseInt(process.env.ACCESS_TOKEN_EXPIRE_DAYS || '7', 10);

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET_KEY environment variable is required');
}

/**
 * Create a JWT token for a user
 * Matches Python's AuthenticationManager.create_jwt_token()
 * 
 * @param {string} username - Username (subject)
 * @param {string} role - User role (admin or user)
 * @returns {string} - JWT token string
 */
export function createJWTToken(username, role) {
  const expire = new Date();
  expire.setDate(expire.getDate() + TOKEN_EXPIRE_DAYS);
  
  // Payload matches Python: {"sub": username, "role": role, "exp": expire}
  const payload = {
    sub: username,
    role: role,
    exp: Math.floor(expire.getTime() / 1000), // JWT expects seconds since epoch
  };
  
  // Use HS256 algorithm (matches Python)
  const token = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
  
  return token;
}

/**
 * Verify a JWT token and return the payload, or null if invalid
 * Matches Python's AuthenticationManager.verify_jwt_token()
 * 
 * @param {string} token - JWT token string
 * @returns {object|null} - Decoded payload or null if invalid/expired
 */
export function verifyJWTToken(token) {
  try {
    // Verify using HS256 algorithm (matches Python)
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    return payload;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      // Token expired (matches Python's jwt.ExpiredSignatureError)
      return null;
    } else if (error.name === 'JsonWebTokenError' || error.name === 'NotBeforeError') {
      // Invalid token (matches Python's jwt.InvalidTokenError)
      return null;
    }
    // Other errors
    console.error('JWT verification error:', error);
    return null;
  }
}

/**
 * Get token expiration days (for cookie max-age calculation)
 */
export function getTokenExpireDays() {
  return TOKEN_EXPIRE_DAYS;
}

