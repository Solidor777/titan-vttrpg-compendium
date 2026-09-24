// Compiles the JSON pack sources into the LevelDB packs Foundry loads.
// Usage: npm run packs:compile [-- <srcDir> <destDir>]   (defaults: src/packs -> packs)
// Compiling in place is safe: the CLI deletes keys missing from the sources and compacts each database. Foundry
// must not have the module's packs open (restart Foundry, or leave the module disabled in the running world).
import { compilePack } from '@foundryvtt/foundryvtt-cli';
import { ClassicLevel } from 'classic-level';
import fs from 'node:fs';
import path from 'node:path';
import { PACKS, SRC_PACKS } from './paths.mjs';

/** @type {string[]} The source and destination roots, from the command line or the module defaults. */
const [src = SRC_PACKS, dest = PACKS] = process.argv.slice(2);

for (const pack of fs.readdirSync(src)) {
   /** @type {string} The compiled database directory for this pack. */
   const packDir = path.join(dest, pack);
   await compilePack(path.join(src, pack), packDir, {
      recursive: true,
      log: false,
   });

   // Reports the compiled document count per collection so a missing or duplicated document is visible.
   /** @type {ClassicLevel} The compiled database, reopened read-only for the count. */
   const db = new ClassicLevel(packDir, {
      valueEncoding: 'json',
   });
   await db.open();
   /** @type {Object<string, number>} Document count per collection key (items, folders, effects, ...). */
   const counts = {};
   for (const key of await db.keys().all()) {
      const collection = key.split('!')[1];
      counts[collection] = (counts[collection] ?? 0) + 1;
   }
   await db.close();
   console.log(pack, JSON.stringify(counts));
}
