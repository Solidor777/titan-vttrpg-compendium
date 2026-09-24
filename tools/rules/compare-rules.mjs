// Compares every item and actor description in the pack sources against the TITAN Rules Compendium markdown and
// writes a word-diff report, so a new edition of the rules shows which documents changed.
// Usage: npm run rules:compare -- <rules.md> [srcDir]   (default srcDir: src/packs)
// Output (.work/): compare-report.txt (SAME/DIFF per document, NO-MD for documents the rules lack, NO-PACK for
// rules entries without a document), entries.json (the parsed rules), matches.json (document -> rules line).
import fs from 'node:fs';
import path from 'node:path';
import { SRC_PACKS, WORK } from '../paths.mjs';
import { parseEntries, loadDocs, key, htmlText, mdText, wdiff, splitPackDescription } from './lib.mjs';

/** @type {string[]} The rules markdown path and the pack sources root. */
const [rulesFile, srcDir = SRC_PACKS] = process.argv.slice(2);
if (!rulesFile) {
   console.error('Usage: npm run rules:compare -- <rules.md> [srcDir]');
   process.exit(1);
}
fs.mkdirSync(WORK, {
   recursive: true,
});
const entries = parseEntries(fs.readFileSync(rulesFile, 'utf8'));
fs.writeFileSync(path.join(WORK, 'entries.json'), JSON.stringify(entries, null, 1));
const docs = loadDocs(srcDir).filter(({ d }) => d._key.startsWith('!items!') || d._key.startsWith('!actors!'));

/**
 * Strips a document name's instance suffix, e.g. `(Choose)` or `(4/4)`, to find its rules entry.
 * @param {string} n - The document name.
 * @returns {string} The name as the rules write it.
 */
export function baseName(n) {
   return n
      .replace(/\s*\((Choose|Rank I|\d+\/\d+|\d+)\)\s*$/i, '')
      .replace('Assesment', 'Assessment')
      .replace('Observent', 'Observant')
      .replace('Blesssing', 'Blessing')
      .replace('Path of the Veiled Moon', 'Path of Veiled Moon');
}
const byKey = new Map();
for (const e of entries) {
   const k = key(e.title);
   if (!byKey.has(k)) {
      byKey.set(k, []);
   }
   byKey.get(k).push(e);
}
const used = new Set();
const out = [];
const matches = [];
for (const { pack, d, f } of docs) {
   if (d.type === 'effect') {
      continue;
   }
   const cands = byKey.get(key(baseName(d.name))) ?? [];
   if (!cands.length) {
      out.push(`NO-MD   [${pack}] ${d.name}`);
      continue;
   }
   const { fields, rest } = splitPackDescription(d.system?.description ?? d.system?.details?.description ?? '');
   const packText = htmlText(rest);
   let best = null;
   for (const c of cands) {
      const diffs = wdiff(packText, mdText(c.body));
      if (!best || diffs.length < best.diffs.length) {
         best = {
            c,
            diffs,
         };
      }
   }
   used.add(best.c);
   matches.push({
      f,
      pack,
      name: d.name,
      line: best.c.line,
   });
   const hdr = best.c.header.map((h) => `${h.label}: ${h.value}`).join(' | ');
   const pf = fields.map((h) => `${h.label}: ${h.value}`).join(' | ');
   const lines = [];
   if (best.diffs.length) {
      lines.push(...best.diffs);
   }
   out.push(
      `${best.diffs.length ? 'DIFF ' : 'SAME '}  [${pack}] ${d.name}  (md ${best.c.line})\n    MDHDR: ${hdr}\n    PKHDR: ${pf}` +
         (lines.length ? `\n${lines.join('\n')}` : ''),
   );
}
for (const e of entries) {
   if (!used.has(e) && e.level >= 3) {
      out.push(`NO-PACK md ${e.line} L${e.level} ${e.path.join(' > ')} > ${e.title}`);
   }
}
fs.writeFileSync(path.join(WORK, 'compare-report.txt'), out.join('\n'));
fs.writeFileSync(path.join(WORK, 'matches.json'), JSON.stringify(matches, null, 1));
const count = (p) => out.filter((l) => l.startsWith(p)).length;
console.log({
   same: count('SAME'),
   diff: count('DIFF'),
   noMd: count('NO-MD'),
   noPack: count('NO-PACK'),
});
