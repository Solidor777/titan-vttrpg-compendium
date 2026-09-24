// Deterministic Foundry ids and TITAN uuids so re-running the build is stable.
import crypto from 'node:crypto';

export function makeId(seed) {
   const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
   const bytes = crypto.createHash('sha256').update(seed).digest();
   let id = '';
   for (let i = 0; i < 16; i++) {
      id += alphabet[bytes[i] % alphabet.length];
   }
   return id;
}

export function uuid(seed) {
   const h = crypto.createHash('sha256').update(`uuid:${seed}`).digest('hex');
   return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
