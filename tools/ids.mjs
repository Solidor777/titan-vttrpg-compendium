// Deterministic Foundry document ids and TITAN uuids: the same seed always yields the same value, so re-running a
// build reproduces every id.
import crypto from 'node:crypto';

/**
 * Derives a 16-character Foundry document id from a seed.
 * @param {string} seed - The seed string.
 * @returns {string} The id.
 */
export function makeId(seed) {
   const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
   const bytes = crypto.createHash('sha256').update(seed).digest();
   let id = '';
   for (let i = 0; i < 16; i++) {
      id += alphabet[bytes[i] % alphabet.length];
   }
   return id;
}

/**
 * Derives a TITAN uuid (version-4 shaped) from a seed.
 * @param {string} seed - The seed string.
 * @returns {string} The uuid.
 */
export function uuid(seed) {
   const h = crypto.createHash('sha256').update(`uuid:${seed}`).digest('hex');
   return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
