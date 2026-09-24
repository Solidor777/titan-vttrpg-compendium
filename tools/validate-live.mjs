// Validates pack sources inside a running Foundry world with the TITAN system, without saving anything: every
// document is constructed in memory with strict validation, and one unsaved player actor carrying every item and
// effect runs derived-data preparation (NaN scan, roll data, chat payloads). Each valid document's toObject() is
// written out, which is its source migrated to the running Foundry and TITAN versions.
// Usage: npm run validate [-- <srcDir> <outDir>]   (defaults: src/packs -> .work/validated)
// Environment: FOUNDRY_URL, FOUNDRY_USER (a GM with no other open session), FOUNDRY_PASSWORD (if the user has one).
// Output: <outDir>/<pack>/*.json and validate-report.json beside <outDir>. Review, then copy over src/packs to
// adopt the migrated sources.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { walk } from './rules/lib.mjs';
import { FOUNDRY_URL, FOUNDRY_USER, SRC_PACKS, WORK } from './paths.mjs';

/** @type {string[]} The pack sources root and the output root. */
const [srcDir = SRC_PACKS, outDir = path.join(WORK, 'validated')] = process.argv.slice(2);
if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
   console.error(`Output ${outDir} is not empty; move it to the recycle bin first.`);
   process.exit(1);
}

/** @type {Object<string, string>} Foundry document name per pack collection key. */
const DOC_BY_KEY = {
   items: 'Item',
   actors: 'Actor',
   effects: 'ActiveEffect',
   journal: 'JournalEntry',
   folders: 'Folder',
};
/** @type {Object<string, object[]>} Every document source, grouped by pack. */
const packs = {};
for (const pack of fs.readdirSync(srcDir)) {
   packs[pack] = [...walk(path.join(srcDir, pack))].map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
}

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const consoleErrors = [];
page.on('console', (m) => {
   if (m.type() === 'error') {
      consoleErrors.push(m.text());
   }
});
await page.goto(`${FOUNDRY_URL}/join`);
await page.selectOption('select[name="userid"]', {
   label: FOUNDRY_USER,
});
if (process.env.FOUNDRY_PASSWORD) {
   await page.fill('input[name="password"]', process.env.FOUNDRY_PASSWORD);
}
await page.click('button[name="join"]');
await page.waitForURL('**/game');
await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120_000 });
const env = await page.evaluate(() => ({
   core: game.version,
   system: game.system.id,
   systemVersion: game.system.version,
}));
console.log('live env', env);
consoleErrors.length = 0;

const report = {
   env,
   errors: [],
   warnings: [],
   derived: null,
};
for (const [pack, docs] of Object.entries(packs)) {
   const res = await page.evaluate(({ docs, DOC_BY_KEY }) => {
      const out = [];
      const errors = [];
      for (const src of docs) {
         const kind = src._key.split('!')[1];
         const docName = DOC_BY_KEY[kind];
         const cls = CONFIG[docName].documentClass;
         try {
            const data = foundry.utils.deepClone(src);
            delete data._key;
            if (data.flags?.core?.sourceId) {
               delete data.flags.core.sourceId;
            }
            const doc = new cls(data, {
               strict: true,
            });
            if (doc.invalid) {
               throw new Error('invalid document');
            }
            const obj = doc.toObject();
            if (obj._stats) {
               obj._stats.compendiumSource = null;
               obj._stats.duplicateSource = null;
               obj._stats.exportSource = null;
               obj._stats.coreVersion = game.version;
               obj._stats.systemId = game.system.id;
               obj._stats.systemVersion = game.system.version;
            }
            out.push({
               key: src._key,
               obj,
            });
         }
         catch (e) {
            errors.push(`${docName} "${src.name}" (${src._id}): ${e.message}`);
         }
      }
      return {
         out,
         errors,
      };
   }, {
      docs,
      DOC_BY_KEY,
   });
   report.errors.push(...res.errors.map((e) => `[${pack}] ${e}`));
   const dir = path.join(outDir, pack);
   fs.mkdirSync(dir, {
      recursive: true,
   });
   for (const { key, obj } of res.out) {
      obj._key = key;
      // Embedded collections need their own keys for compilePack.
      if (key.startsWith('!journal!')) {
         for (const p of obj.pages ?? []) {
            p._key = `!journal.pages!${obj._id}.${p._id}`;
         }
      }
      if (key.startsWith('!actors!')) {
         for (const i of obj.items ?? []) {
            i._key = `!actors.items!${obj._id}.${i._id}`;
         }
         for (const e of obj.effects ?? []) {
            e._key = `!actors.effects!${obj._id}.${e._id}`;
         }
      }
      if (key.startsWith('!items!')) {
         for (const e of obj.effects ?? []) {
            e._key = `!items.effects!${obj._id}.${e._id}`;
         }
      }
      const safe = `${obj.name}`.replace(/[^A-Za-z0-9]+/g, '_');
      fs.writeFileSync(path.join(dir, `${safe}_${obj._id}.json`), `${JSON.stringify(obj, null, 2)}\n`);
   }
   console.log(pack, `${res.out.length} ok`, `${res.errors.length} errors`);
}

// Derived-data exercise: one unsaved player actor carrying every ability/item and every effect.
const items = Object.values(packs).flat().filter((d) => d._key.startsWith('!items!'));
const effects = packs.effects.filter((d) => d._key.startsWith('!effects!'));
report.derived = await page.evaluate(({ items, effects }) => {
   const strip = (d) => {
      const c = foundry.utils.deepClone(d);
      delete c._key;
      delete c.folder;
      return c;
   };
   const problems = [];
   const origError = console.error;
   const captured = [];
   console.error = (...a) => {
      captured.push(a.map(String).join(' '));
      origError(...a);
   };
   try {
      const actor = new CONFIG.Actor.documentClass({
         name: 'Pack Validation Actor',
         type: 'player',
         items: items.map(strip),
         effects: effects.map(strip),
      });
      actor.prepareData();
      const sys = actor.system;
      const nan = [];
      const scan = (o, p) => {
         for (const [k, v] of Object.entries(o ?? {})) {
            if (typeof v === 'number' && Number.isNaN(v)) {
               nan.push(`${p}.${k}`);
            }
            else if (v && typeof v === 'object' && !Array.isArray(v) && p.split('.').length < 6) {
               scan(v, `${p}.${k}`);
            }
         }
      };
      scan(sys, 'system');
      if (nan.length) {
         problems.push(`NaN derived values: ${nan.slice(0, 20).join(', ')}`);
      }
      // Each spell's roll data and each item's chat payload must build.
      for (const item of actor.items) {
         try {
            item.getRollData?.();
            item.buildChatMessageData?.();
         }
         catch (e) {
            problems.push(`${item.type} "${item.name}": ${e.message}`);
         }
      }
      for (const effect of actor.effects) {
         try {
            effect.getRollData?.();
            effect.buildChatMessageData?.();
         }
         catch (e) {
            problems.push(`effect "${effect.name}": ${e.message}`);
         }
      }
      return {
         items: actor.items.size,
         effects: actor.effects.size,
         invalidItems: actor.items.invalidDocumentIds?.size ?? 0,
         invalidEffects: actor.effects.invalidDocumentIds?.size ?? 0,
         body: sys.attribute?.body?.value,
         defense: sys.rating?.defense?.value,
         problems,
         consoleErrors: captured.slice(0, 20),
      };
   }
   catch (e) {
      return {
         fatal: `${e.message}\n${e.stack}`,
      };
   }
   finally {
      console.error = origError;
   }
}, {
   items,
   effects,
});
report.pageErrors = pageErrors;
report.consoleErrors = consoleErrors.slice(0, 50);
fs.writeFileSync(path.join(path.dirname(outDir), 'validate-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
   errors: report.errors.length,
   derived: report.derived,
   pageErrors: pageErrors.length,
   consoleErrors: consoleErrors.length,
}, null, 2));
await browser.close();
