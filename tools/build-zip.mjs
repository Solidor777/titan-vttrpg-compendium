// Packages the installable module: module.json, README.md, icons/, and the compiled packs/ into
// titan-vttrpg-compendium.zip at the module root. Sources and tools stay out of the release.
// Usage: npm run zip   (run packs:compile first)
import { zipSync } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.mjs';

/** @type {string[]} Top-level files and folders shipped in the release. */
const INCLUDE = [
   'module.json',
   'README.md',
   'icons',
   'packs',
];

/** @type {RegExp} LevelDB runtime files that a fresh install must not inherit (lock and info logs). */
const EXCLUDE = /(^|\/)(LOCK|LOG|LOG\.old)$/;

/** @type {Object<string, Uint8Array>} Zip entries keyed by their forward-slash path inside the archive. */
const entries = {};

/**
 * Adds a file, or every file under a folder, to the zip entries.
 * @param {string} rel - The path relative to the module root, with forward slashes.
 * @returns {void}
 */
function add(rel) {
   const abs = path.join(ROOT, rel);
   if (fs.statSync(abs).isDirectory()) {
      for (const name of fs.readdirSync(abs)) {
         add(`${rel}/${name}`);
      }
   }
   else if (!EXCLUDE.test(rel)) {
      entries[rel] = fs.readFileSync(abs);
   }
}

for (const rel of INCLUDE) {
   add(rel);
}
/** @type {string} The release archive path. */
const zipPath = path.join(ROOT, 'titan-vttrpg-compendium.zip');
fs.writeFileSync(zipPath, zipSync(entries, {
   level: 9,
}));
console.log(`${Object.keys(entries).length} files -> ${zipPath}`);
