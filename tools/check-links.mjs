// Verifies that every @UUID link in the pack sources resolves: compendium links must target a document (and
// journal page, and heading anchor) in this module, and relative page links must target a page of the Rules
// journal. Exits non-zero when any link is broken.
// Usage: npm run check:links [-- <srcDir>]   (default: src/packs)
import fs from 'node:fs';
import path from 'node:path';
import { walk } from './rules/lib.mjs';
import { SRC_PACKS } from './paths.mjs';

/** @type {string} The module id every compendium link must name. */
const MODULE_ID = 'titan-vttrpg-compendium';

/** @type {string} The pack sources root. */
const dir = process.argv[2] ?? SRC_PACKS;

/** @type {{pack: string, d: object}[]} Every document source with its pack name. */
const docs = [...walk(dir)].map((f) => ({
   pack: path.relative(dir, f).split(path.sep)[0],
   d: JSON.parse(fs.readFileSync(f, 'utf8')),
}));

/** @type {Map<string, object>} Documents keyed by `<pack>:<id>`. */
const byPackId = new Map(docs.map(({ pack, d }) => [`${pack}:${d._id}`, d]));

/** @type {object} The Rules journal, whose pages relative links target. */
const journal = docs.find(({ pack }) => pack === 'rules').d;

/**
 * Reproduces Foundry's heading anchor slug for a journal page heading.
 * @param {string} t - The heading HTML.
 * @returns {string} The anchor slug.
 */
const slug = (t) => t
   .toLowerCase()
   .replace(/<[^>]+>/g, '')
   .replace(/[^a-z0-9]+/g, '-')
   .replace(/^-|-$/g, '');

/** @type {Map<string, Set<string>>} Heading anchors per Rules journal page id. */
const pageAnchors = new Map(journal.pages.map((p) => [
   p._id,
   new Set([...p.text.content.matchAll(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/g)].map((m) => slug(m[1]))),
]));

/**
 * Checks that a Rules journal page exists and carries the anchor, when one is given.
 * @param {string} pageId - The page id.
 * @param {string} [anchor] - The heading anchor.
 * @returns {string|null} The problem, or null when the target resolves.
 */
function checkPage(pageId, anchor) {
   if (!pageAnchors.has(pageId)) {
      return `missing page ${pageId}`;
   }
   if (anchor && !pageAnchors.get(pageId).has(anchor)) {
      return `anchor #${anchor} missing on page ${pageId}`;
   }
   return null;
}

/** @type {string[]} Every broken link found. */
const problems = [];
/** @type {number} The number of links checked. */
let count = 0;
for (const { d } of docs) {
   for (const m of JSON.stringify(d).matchAll(/@UUID\[([^\]]+)\]/g)) {
      count++;
      const [ref, anchor] = m[1].split('#');
      if (ref.startsWith('.')) {
         const problem = checkPage(ref.slice(1), anchor);
         if (problem) {
            problems.push(`${d.name}: relative ${problem}`);
         }
         continue;
      }

      // Compendium.<module>.<pack>.<Document>.<id>[.JournalEntryPage.<pageId>]
      const parts = ref.split('.');
      if (parts[0] !== 'Compendium' || parts[1] !== MODULE_ID) {
         problems.push(`${d.name}: foreign link ${ref}`);
         continue;
      }
      if (!byPackId.has(`${parts[2]}:${parts[4]}`)) {
         problems.push(`${d.name}: missing target ${ref}`);
         continue;
      }
      if (parts[5] === 'JournalEntryPage') {
         const problem = checkPage(parts[6], anchor);
         if (problem) {
            problems.push(`${d.name}: ${problem}`);
         }
      }
   }
}
console.log(`${count} links checked; ${problems.length} problems`);
if (problems.length > 0) {
   console.log(problems.join('\n'));
   process.exit(1);
}
