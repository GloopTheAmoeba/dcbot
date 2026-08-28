import { randomBytes, createHash } from 'crypto';

/**
 * Generate a cryptographically secure, random activation code.
 * Format example: "DFH199-8K2A-X9L4"
 */
export function generateActivationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars (0, O, 1, I)
  const getRandomString = (length: number) => {
    const bytes = randomBytes(length);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  };

  const prefix = 'DFH199';
  const part1 = getRandomString(4);
  const part2 = getRandomString(4);
  return `${prefix}-${part1}-${part2}`;
}

/**
 * Normalize and compute SHA-256 hash of an activation code for secure storage/lookup.
 */
export function hashActivationCode(code: string): string {
  const normalized = code.trim().toUpperCase().replace(/[\s-]/g, '');
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Clean display version of code for admin dashboard presentation.
 */
export function formatCodeDisplay(code: string): string {
  return code.trim().toUpperCase();
}
