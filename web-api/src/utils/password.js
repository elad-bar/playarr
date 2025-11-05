import crypto from 'crypto';
import bcrypt from 'bcrypt';

/**
 * Hash a password using SHA-256 pre-hash + bcrypt
 * 
 * This matches Python's AuthenticationManager._hash_password() exactly:
 * - Pre-hash with SHA-256 to get fixed-length hash (32 bytes)
 * - Hash with bcrypt using the binary digest
 * - Return as string for storage
 * 
 * @param {string} password - Plain text password
 * @returns {Promise<string>} - Bcrypt hash string
 */
export async function hashPassword(password) {
  // Pre-hash with SHA-256 to get a fixed-length hash (32 bytes)
  // This avoids bcrypt's 72-byte limit
  const prehash = crypto.createHash('sha256').update(password, 'utf8').digest();
  
  // Hash with bcrypt using the binary digest (32 bytes, well under 72-byte limit)
  const salt = await bcrypt.genSalt();
  const hashed = await bcrypt.hash(prehash, salt);
  
  // Return as string for storage (bcrypt returns string by default)
  return hashed;
}

/**
 * Verify a password against its hash
 * 
 * This matches Python's AuthenticationManager._verify_password() exactly:
 * - Pre-hash password with SHA-256
 * - Verify using bcrypt
 * 
 * @param {string} plainPassword - Plain text password to verify
 * @param {string} hashedPassword - Bcrypt hash string from database
 * @returns {Promise<boolean>} - True if password matches
 */
export async function verifyPassword(plainPassword, hashedPassword) {
  try {
    // Pre-hash with SHA-256 to match the hashing process
    const prehash = crypto.createHash('sha256').update(plainPassword, 'utf8').digest();
    
    // Verify using bcrypt
    // Ensure hashedPassword is a string (bcrypt.compare handles string/buffer)
    const result = await bcrypt.compare(prehash, hashedPassword);
    
    return result;
  } catch (error) {
    console.error('Error verifying password:', error);
    return false;
  }
}

