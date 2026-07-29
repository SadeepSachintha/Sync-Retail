import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
// Derive key using secure scrypt sync (fallback key provided for development)
const ENCRYPTION_KEY = crypto.scryptSync(process.env.LOCAL_DB_KEY || 'sync_retail_secret_pos_key_2026', 'salt', 32);
const IV_LENGTH = 16;

/**
 * Encrypt a value into iv:ciphertext
 */
export function encrypt(value) {
  if (value === null || value === undefined) return value;
  const textStr = value.toString();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(textStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt an iv:ciphertext value back to its original data type
 */
export function decrypt(value) {
  if (value === null || value === undefined) return value;
  const textStr = value.toString();
  if (!textStr.includes(':')) return value; // return unchanged if not in encrypted format
  
  try {
    const textParts = textStr.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    // Attempt casting to number if string matches a clean number
    const num = Number(decrypted);
    return isNaN(num) || decrypted.trim() === '' ? decrypted : num;
  } catch (error) {
    // If decryption fails, return original column value as safe fallback
    return value;
  }
}
