// Extracts LevelDB packs into JSON sources, one folder per pack and one file per document (folders nested).
// Usage: npm run packs:extract [-- <packsDir> <destDir>]   (defaults: packs -> .work/extracted)
// The destination must be empty or absent: the tool never deletes files, so stale sources cannot be overwritten
// silently. To refresh src/packs from edited packs, extract to .work, review the diff, then move the result.
// Opening a pack rewrites its LevelDB manifest and log files (the documents are unchanged), so extracting from
// packs/ leaves git changes there; recompile from src/packs or restore packs/ afterwards.
import { extractPack } from '@foundryvtt/foundryvtt-cli';
import fs from 'node:fs';
import path from 'node:path';
import { PACKS, WORK } from './paths.mjs';

/** @type {string[]} The packs root and the destination root, from the command line or the defaults. */
const [src = PACKS, dest = path.join(WORK, 'extracted')] = process.argv.slice(2);

if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
   console.error(`Destination ${dest} is not empty; move it to the recycle bin first.`);
   process.exit(1);
}

for (const pack of fs.readdirSync(src)) {
   await extractPack(path.join(src, pack), path.join(dest, pack), {
      folders: true,
      log: false,
   });
   console.log('extracted', pack);
}
