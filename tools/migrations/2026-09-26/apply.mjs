// 2026-09-26 migration: brings src/packs to the 09_26_2026 rules. Reads src/packs and the rules markdown named by
// RULES_FILE, and writes every changed or new document (plus the rebuilt Rules journal) to
// .work/migration-2026-09-26/src-new/<pack>/, with renames.txt listing files that changed name. The tools never
// delete or overwrite sources: copy src-new over src/packs by hand and move each renamed file's old copy to the
// recycle bin. New documents are cloned from existing ones so their shape matches the validated sources.
import fs from 'node:fs';
import path from 'node:path';
import { SRC_PACKS, WORK } from '../../paths.mjs';
import { parseEntries, mdToHtml, key, loadDocs } from '../../rules/lib.mjs';
import { buildJournal } from '../../rules/journal.mjs';
import { makeId, uuid } from '../../ids.mjs';

if (!process.env.RULES_FILE) {
   throw new Error('Set RULES_FILE to the TITAN Rules Compendium markdown path.');
}
/** @type {string} The compendium module id used in @UUID links. */
const MODULE = 'titan-vttrpg-compendium';
/** @type {string} The output directory; must be empty. */
const OUT = path.join(WORK, 'migration-2026-09-26', 'src-new');
/** @type {number} Timestamp stamped on new and changed documents (2026-09-26). */
const NOW = Date.UTC(2026, 8, 26);
/** @type {string[]} Log lines. */
const log = [];
const L = (...a) => log.push(a.join(' '));

const md = fs.readFileSync(process.env.RULES_FILE, 'utf8');
const entries = parseEntries(md);
const docs = loadDocs(SRC_PACKS);
/** @type {Map<object, string>} Original JSON of each loaded document, to detect changes. */
const originals = new Map(docs.map(({ d }) => [d, JSON.stringify(d)]));
/** @type {{pack: string, d: object, f: string|null}[]} Every document to write, changed or new. */
const dirty = [];

const escHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const P = (t) => `<p>${t}</p>`;
const hdr = (e, label) => e.header.find((h) => h.label.toLowerCase() === label.toLowerCase())?.value;
const splitList = (v) => (v ? v.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean) : []);
const find = (pack, name, type) => {
   const hits = docs.filter((x) => x.pack === pack && x.d.name === name && (!type || x.d.type === type));
   if (hits.length !== 1) {
      throw new Error(`expected 1 ${pack}/${name}/${type}, found ${hits.length}`);
   }
   return hits[0];
};
const entry = (root, title) => {
   const hits = entries.filter((x) => x.path[0] === root && x.title === title);
   if (hits.length !== 1) {
      throw new Error(`expected 1 rules entry ${root} > ${title}, found ${hits.length}`);
   }
   return hits[0];
};

// ---------- source text fixes the maintainer approved (see the migration README) ----------
/** Applies the approved corrections to a rules entry in place. */
function fixEntry(e) {
   for (const h of e.header) {
      h.value = h.value.replace(/Borrow the Flame,/, 'Borrow the Flames,');
   }
   e.body = e.body.map((l) => l.replace(/\*Channel the Blaze\*/g, '*Channel the Flames*'));
   if (e.title === 'Hunger of Urdokai') {
      const range = e.header.find((h) => h.label === 'Range');
      L(`SOURCE-FIX Hunger of Urdokai: Range "${range.value}" -> "10 spaces" (the text reaches 10 spaces)`);
      range.value = '10 spaces';
   }
   // Conjurer of Urdokai's body runs into a nameless duplicate of Fangs of Urdokai; the copy is skipped.
   if (e.title === 'Conjurer of Urdokai') {
      const cut = e.body.findIndex((l) => /^\*\*Cost:\*\*/.test(l));
      if (cut < 0) {
         throw new Error('Conjurer of Urdokai: nameless block not found');
      }
      e.body = e.body.slice(0, cut);
      while (e.body.length && !e.body.at(-1).trim()) {
         e.body.pop();
      }
      L('SOURCE-SKIP nameless ability after Conjurer of Urdokai (duplicate of Fangs of Urdokai)');
   }
}
for (const e of entries) {
   fixEntry(e);
}
const bodyHtml = (e) => mdToHtml(e.body.filter((l) => !/^#+\s*$/.test(l)));
const DESC_HEADER = ['Requirements', 'Cost', 'Range', 'Area'];
const headerHtml = (e) => e.header.filter((h) => DESC_HEADER.includes(h.label))
   .map((h) => `<p><strong>${escHtml(h.label)}:</strong> ${escHtml(h.value)}</p>`).join('');
const descriptionFor = (e) => headerHtml(e) + bodyHtml(e);
const TRAIT_RENAMES = {
   'Combat Style': 'Martial Style',
};
const traitsFor = (e) => splitList(hdr(e, 'Traits')).map((t) => TRAIT_RENAMES[t] ?? t);
const traitObjs = (names) => names.map((name) => ({
   name,
   description: '',
   uuid: uuid(`trait:${name}`),
}));
const effectLink = (list) => {
   const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
   const links = sorted.map((ae) => `@UUID[Compendium.${MODULE}.effects.ActiveEffect.${ae._id}]{${ae.name}}`).join(', ');
   return `<p><strong>${sorted.length > 1 ? 'Effects' : 'Effect'}:</strong> ${links}</p>`;
};
const markDirty = (pack, d, f = null) => {
   if (!dirty.some((x) => x.d === d)) {
      dirty.push({
         pack,
         d,
         f,
      });
   }
};

// ---------- templates: existing documents cloned so new ones match the validated shape ----------
const tplAbility = find('combat-styles', 'Zephyr Style', 'ability').d;
const tplEffect = find('effects', 'Zephyr Style', 'effect').d;
const tplItemFolder = find('combat-styles', 'Zephyr Style', 'Item').d;
const tplEffectFolder = docs.find((x) => x.pack === 'effects' && x.d.name === 'Zephyr Style' && x.d.type === 'ActiveEffect').d;
const stats = () => ({
   ...structuredClone(tplAbility._stats),
   createdTime: NOW,
   modifiedTime: NOW,
});

function mkFolder(pack, type, name, parent, seedPrefix) {
   const tpl = type === 'Item' ? tplItemFolder : tplEffectFolder;
   const id = makeId(`${seedPrefix}:${parent ?? ''}/${name}`);
   const f = structuredClone(tpl);
   Object.assign(f, {
      _id: id,
      _key: `!folders!${id}`,
      name,
      type,
      folder: parent,
      sort: 0,
      _stats: stats(),
   });
   markDirty(pack, f);
   L(`NEW-FOLDER [${pack}] ${name}`);
   return id;
}
function mkAbility(pack, e, { folder, sort, img, rarity = 'uncommon', flags = {}, checks = [] }) {
   const id = makeId(`${pack}-item:${e.title}`);
   const d = structuredClone(tplAbility);
   Object.assign(d, {
      _id: id,
      _key: `!items!${id}`,
      name: e.title,
      img,
      folder,
      sort,
      _stats: stats(),
   });
   d.system.description = descriptionFor(e);
   d.system.check = checks.map((c) => ({
      ...c,
      uuid: uuid(`check:${e.title}:${c.label}`),
   }));
   d.system.customTrait = traitObjs(traitsFor(e));
   d.system.rarity = (hdr(e, 'Rarity') ?? rarity).toLowerCase();
   d.system.rulesElement = [];
   d.system.action = Boolean(flags.action);
   d.system.reaction = Boolean(flags.reaction);
   d.system.passive = Boolean(flags.passive);
   markDirty(pack, d);
   L(`NEW-ITEM [${pack}] ${d.name}`);
   return d;
}
const check = (label, difficulty, opts = {}) => ({
   label,
   attribute: 'soul',
   skill: 'metaphysics',
   difficulty,
   complexity: 1,
   resolveCost: opts.resolveCost ?? 0,
   isDamage: opts.isDamage ?? false,
   isHealing: false,
   initialValue: 1,
   scaling: true,
   resistanceCheck: opts.resistanceCheck ?? 'none',
   opposedCheck: {
      enabled: false,
      attribute: 'body',
      skill: 'athletics',
   },
   damageReducedBy: 'none',
});
function mkEffect(item, name, folder, { duration, description, rules = [] }) {
   const id = makeId(`effect:${name}`);
   const d = structuredClone(tplEffect);
   Object.assign(d, {
      _id: id,
      _key: `!effects!${id}`,
      name,
      img: item.img,
      description,
      folder,
      sort: 0,
      _stats: stats(),
   });
   d.system.duration = {
      initiative: 1,
      custom: '',
      remaining: 1,
      ...duration,
   };
   d.system.customTrait = structuredClone(item.system.customTrait);
   d.system.rulesElement = rules.map((r, i) => ({
      ...r,
      uuid: uuid(`re:${name}:${i}`),
   }));
   markDirty('effects', d);
   L(`NEW-EFFECT ${name}`);
   return d;
}
const linkEffects = (item, list) => {
   item.system.description += effectLink(list);
};
const flat = (selector, k, value) => ({
   operation: 'flatModifier',
   selector,
   key: k,
   value,
});
const turnMsg = (label, html) => ({
   operation: 'turnMessage',
   selector: 'turnStart',
   message: `<p><strong>${label}:</strong> ${html}</p>`,
});
const rollMsg = (label, html) => ({
   operation: 'rollMessage',
   checkType: 'attack',
   selector: 'any',
   key: '',
   message: `<p><strong>${label}:</strong> ${html}</p>`,
});
const SUSTAIN = 'You may spend <strong>1 Resolve</strong> at the start of your turn to sustain this effect.';

// ---------- 1. trait rename: Combat Style -> Martial Style ----------
{
   let n = 0;
   for (const { pack, d } of docs) {
      const traits = d.system?.customTrait;
      if (!Array.isArray(traits)) {
         continue;
      }
      for (const t of traits) {
         if (TRAIT_RENAMES[t.name]) {
            t.name = TRAIT_RENAMES[t.name];
            t.uuid = uuid(`trait:${t.name}`);
            markDirty(pack, d);
            n++;
         }
      }
   }
   L(`TRAIT-RENAMED Combat Style -> Martial Style on ${n} documents`);
}

// ---------- 2. rebuilt descriptions of existing documents ----------
const RENAMES = {
   'Flinging Updraft': 'Fleeing Updraft',
};
const rebuild = (pack, doc, e) => {
   const link = doc.system.description.match(/<p><strong>Effects?:<\/strong> .*?<\/p>$/)?.[0] ?? '';
   const html = descriptionFor(e) + link;
   if (html !== doc.system.description) {
      doc.system.description = html;
      markDirty(pack, doc);
      L(`DESCRIPTION-REBUILT [${pack}] ${doc.name}`);
   }
};
for (const { pack, d } of docs.filter((x) => x.pack === 'combat-styles' && x.d.type === 'ability')) {
   const title = RENAMES[d.name] ?? d.name;
   rebuild(pack, d, entry('Martial Styles', title));
   if (title !== d.name) {
      L(`RENAMED [${pack}] ${d.name} -> ${title}`);
      d.name = title;
   }
}
rebuild('sacred-arts', find('sacred-arts', 'Fox Fire', 'ability').d, entry('The Sacred Arts', 'Fox Fire'));

// ---------- 3. existing effects ----------
{
   // Zephyr Style: the end-of-turn rules changed.
   const ae = find('effects', 'Zephyr Style', 'effect').d;
   ae.description = ae.description.replace(/<p><strong><em>Zephyr Style<\/em><\/strong> ends if.*<\/p>$/, P('If you did not spend or gain any <strong>Focus</strong> during your turn, your <strong>Focus</strong> decreases by <strong>-1</strong> at the end of your turn. <strong><em>Zephyr Style</em></strong> ends if you have <strong>0 Focus</strong> at the end of your turn (after accounting for <strong>Channel the Wind</strong>), if you enter another <strong>Stance</strong>, or if you are <strong>Incapacitated</strong>.'));
   const msg = ae.system.rulesElement.find((r) => r.operation === 'turnMessage');
   msg.message = '<p><strong>Zephyr Style:</strong> <strong>Channel the Wind</strong> at the end of your turn. If you did not spend or gain <strong>Focus</strong> this turn, your <strong>Focus</strong> decreases by <strong>-1</strong>. The style ends if you have <strong>0 Focus</strong> at the end of your turn.</p>';
   markDirty('effects', ae);
   L('EFFECT-EDITED Zephyr Style (Focus decay rule)');
}
{
   // Fox Fire: the -1 dice penalty became Disadvantage on Casting Checks until the start of the caster's next turn.
   const ae = find('effects', 'Fox Fire', 'effect').d;
   const text = 'You have <strong>Disadvantage</strong> on any <strong>Casting Checks</strong> you make until the start of the caster\'s next turn.';
   ae.description = `${P('You have been burned by illusory fires.')}${P(text)}`;
   ae.system.duration = {
      ...ae.system.duration,
      type: 'turnStart',
   };
   ae.system.rulesElement = ae.system.rulesElement.filter((r) => r.operation !== 'conditionalCheckModifier').map((r) => ({
      ...r,
      ...(r.message ? { message: `<p><strong>Fox Fire:</strong> ${text}</p>` } : {}),
   }));
   markDirty('effects', ae);
   L('EFFECT-EDITED Fox Fire (Disadvantage until the start of the next turn; the -1 dice modifier is removed)');
}
{
   const f = docs.find((x) => x.pack === 'effects' && x.d.name === 'Combat Styles' && x.d.type === 'ActiveEffect').d;
   f.name = 'Martial Styles';
   markDirty('effects', f);
   L('FOLDER-RENAMED [effects] Combat Styles -> Martial Styles');
}

// ---------- 4. general abilities ----------
{
   const pack = 'abilities';
   const common = find(pack, 'Applied Anatomy', 'ability').d.folder;
   const sibs = docs.filter((x) => x.pack === pack && x.d.type === 'ability' && x.d.folder === common)
      .map((x) => x.d).filter((d) => d.sort > 0).sort((a, b) => a.sort - b.sort);
   const tpl = find(pack, 'Berserker', 'ability').d;
   for (const title of ['Mnemonic Recital', 'Thrifty Spirit']) {
      const e = entry('Abilities', title);
      const next = sibs.find((s) => s.name.localeCompare(title) > 0);
      const prev = sibs[sibs.indexOf(next) - 1];
      const id = makeId(`${pack}-item:${title}`);
      const d = structuredClone(tpl);
      Object.assign(d, {
         _id: id,
         _key: `!items!${id}`,
         name: title,
         folder: common,
         sort: Math.floor((prev.sort + next.sort) / 2),
         _stats: stats(),
         flags: {},
      });
      d.system.description = descriptionFor(e);
      d.system.customTrait = traitObjs(traitsFor(e));
      d.system.rarity = (hdr(e, 'Rarity') ?? 'common').toLowerCase();
      d.system.rulesElement = [];
      d.system.check = [];
      d.system.action = false;
      d.system.reaction = false;
      d.system.passive = true;
      markDirty(pack, d);
      L(`NEW-ITEM [${pack}] ${title} (sort ${d.sort}, between ${prev.name} and ${next.name})`);
   }
}

// ---------- 5. Path of the Mystwalker ----------
{
   const pack = 'sacred-arts';
   const img = 'icons/weapons/swords/sword-guard-purple.webp';
   const root = mkFolder(pack, 'Item', 'Mystwalker', null, `${pack}-folder`);
   const abil = mkFolder(pack, 'Item', 'Abilities', root, `${pack}-folder`);
   const apex = mkFolder(pack, 'Item', 'Apex', root, `${pack}-folder`);
   const sacredFx = docs.find((x) => x.pack === 'effects' && x.d.name === 'Sacred Arts' && x.d.type === 'ActiveEffect').d._id;
   const fxRoot = mkFolder('effects', 'ActiveEffect', 'Mystwalker', sacredFx, 'effects-folder');
   const fxAbil = mkFolder('effects', 'ActiveEffect', 'Abilities', fxRoot, 'effects-folder');
   const fxApex = mkFolder('effects', 'ActiveEffect', 'Apex', fxRoot, 'effects-folder');
   const E = (t) => entry('The Sacred Arts', t);
   const make = (title, folder, sort, flags, checks = []) => mkAbility(pack, E(title), {
      folder,
      sort,
      img,
      rarity: 'rare',
      flags,
      checks,
   });
   make('Path of the Mystwalker', root, 0, {
      passive: true,
   });
   let sort = 0;
   const next = () => (sort += 100000);
   const items = {};
   const action = { action: true };
   const passive = { passive: true };
   items.being = make('Being of Urdokai', abil, next(), passive);
   items.conjurer = make('Conjurer of Urdokai', abil, next(), action);
   items.mirror = make('Mirror of Urdokai', abil, next(), action);
   items.hunger = make('Hunger of Urdokai', abil, next(), action, [check('Hunger', 4, {
      resolveCost: 1,
      isDamage: true,
      resistanceCheck: 'willpower',
   })]);
   items.fangs = make('Fangs of Urdokai', abil, next(), passive, [check('Fangs', 4, {
      resolveCost: 1,
      isDamage: true,
      resistanceCheck: 'willpower',
   })]);
   items.gift = make('Gift of Urdokai', abil, next(), action);
   items.severing = make('Severing of Urdokai', abil, next(), action);
   items.step = make('Step of Urdokai', abil, next(), action);
   items.pull = make('Pull of Urdokai', abil, next(), action);
   items.torment = make('Torment of Urdokai', abil, next(), action, [check('Torment', 4, {
      resolveCost: 1,
      resistanceCheck: 'willpower',
   })]);
   items.unraveling = make('Unraveling of Urdokai', abil, next(), passive);
   items.warding = make('Warding of Urdokai', abil, next(), action);
   items.walker = make('Walker Between Worlds', apex, 100000, action);

   const turn = { type: 'turnStart' };
   linkEffects(items.conjurer, [mkEffect(items.conjurer, 'Conjurer of Urdokai', fxAbil, {
      duration: turn,
      description: P('Until the start of your next turn, the <strong>Veil</strong> is torn within a <strong>5-space-radius</strong> of the chosen point. All creatures in the area are forced into the physical world, attacks and abilities affect spirits, demons, and sacred beasts as if they were magical, and no creature in the area can teleport, go behind the <strong>Veil</strong>, or leave the material world.') + P(SUSTAIN),
      rules: [turnMsg('Conjurer of Urdokai', SUSTAIN)],
   })]);
   linkEffects(items.hunger, [mkEffect(items.hunger, 'Hunger of Urdokai', fxAbil, {
      duration: turn,
      description: P('The wild forces of <strong>Urdokai</strong> tear at your soul. You have <strong>Disadvantage</strong> on any <strong>Willpower</strong> checks you make until the start of the caster\'s next turn.'),
      rules: [turnMsg('Hunger of Urdokai', 'You have <strong>Disadvantage</strong> on any <strong>Willpower</strong> checks you make.')],
   })]);
   linkEffects(items.step, [mkEffect(items.step, 'Step of Urdokai', fxAbil, {
      duration: turn,
      description: P('You partially enter <strong>Urdokai</strong> and are incorporeal until the start of your next turn.') + '<ul><li><p>Attacks without the <strong>Magical</strong> trait cannot harm you. Attacks with the <strong>Magical</strong> trait, spells, and <strong>Path</strong> abilities affect you as normal.</p></li><li><p>You may move through creatures, mundane walls, and barriers, but may not end your turn in another creature\'s space, and you may not enter warded or sanctified spaces.</p></li></ul>' + P('This effect ends early if you become <strong>Incapacitated</strong> or <strong>Dying</strong>, or if you take an <strong>Action</strong> that targets the world or another creature.'),
      rules: [turnMsg('Step of Urdokai', 'You are incorporeal: attacks without the <strong>Magical</strong> trait cannot harm you.')],
   })]);
   linkEffects(items.torment, [mkEffect(items.torment, 'Torment of Urdokai', fxAbil, {
      duration: turn,
      description: P('You hold a shard of the target\'s soul until the start of your next turn. While you hold it and the target is within <strong>30 spaces</strong> of you, you know which space the target occupies, and you may measure the <strong>Range</strong> of your <strong>Mystwalker</strong> attacks and abilities to the target as though it were adjacent to you, with no line of sight needed.') + P(SUSTAIN),
      rules: [turnMsg('Torment of Urdokai', SUSTAIN)],
   })]);
   linkEffects(items.warding, [mkEffect(items.warding, 'Warding of Urdokai', fxAbil, {
      duration: turn,
      description: P('Until the start of the caster\'s next turn, spirits, demons, and sacred beasts have <strong>Disadvantage</strong> on any checks made against you.'),
      rules: [turnMsg('Warding of Urdokai', 'Spirits, demons, and sacred beasts have <strong>Disadvantage</strong> on any checks made against you.')],
   })]);
   linkEffects(items.walker, [mkEffect(items.walker, 'Walker Between Worlds', fxApex, {
      duration: {
         type: 'permanent',
      },
      description: P('You have stepped half through the <strong>Veil</strong>.') + '<ul><li><p>Your <strong>Body</strong> and <strong>Soul</strong> increase by <strong>+2</strong>.</p></li><li><p>You can see every creature behind the <strong>Veil</strong> within <strong>10 spaces</strong> of you.</p></li><li><p>Attacks without the <strong>Magical</strong> trait cannot harm you. Attacks with the <strong>Magical</strong> trait, spells, and <strong>Path</strong> abilities affect you as normal.</p></li><li><p>Once per round, on your turn, when you use an ability with the <strong>Mystwalker</strong> trait, you may reduce its cost by <strong>1 Resolve</strong>.</p></li><li><p>You have <strong>Advantage</strong> on <strong>Attacks</strong> made with <strong><em>Mystwalker</em></strong> against demons, spirits, and sacred beasts.</p></li><li><p>Spirits, demons, and sacred beasts have <strong>Disadvantage</strong> on checks made to resist your spells and abilities.</p></li></ul>' + P('This effect lasts until the end of combat, you become <strong>Incapacitated</strong>, or you are <strong>Dying</strong>. After you use this ability, you cannot use any ability with the <strong>Apex</strong> trait until you complete a <strong>Long Rest</strong>.'),
      rules: [flat('attribute', 'body', 2), flat('attribute', 'soul', 2), turnMsg('Walker Between Worlds', 'Once per round, when you use an ability with the <strong>Mystwalker</strong> trait, you may reduce its cost by <strong>1 Resolve</strong>.')],
   })]);
}

// ---------- 6. new martial styles ----------
{
   const pack = 'combat-styles';
   const fxMartial = docs.find((x) => x.pack === 'effects' && x.d.name === 'Martial Styles' && x.d.type === 'ActiveEffect').d._id;
   const E = (t) => entry('Martial Styles', t);
   // Effect description: the style's bullet list, taken from the rules body verbatim.
   const bullets = (e) => {
      const first = e.body.findIndex((l) => /^\s*[*-]\s/.test(l));
      let last = e.body.length - 1;
      while (!/^\s*([*-]\s|\s+\S)/.test(e.body[last])) {
         last--;
      }
      return mdToHtml(e.body.slice(first, last + 1));
   };
   const STYLES = [
      {
         name: 'Frost Dragon Style',
         img: 'icons/magic/water/barrier-ice-crystal-wall-jagged-blue.webp',
         channel: 'Channel the Current',
         end: 'If you did not spend or gain any <strong>Focus</strong> during your turn, your <strong>Focus</strong> decreases by <strong>-1</strong>. The style ends if you have <strong>0 Focus</strong> at the end of your turn.',
         flags: {
            'Borrow the Current': 'passive',
            'Breaking the Dam': 'action',
            'Breaking the Ice': 'action',
            'Cold Snap': 'action',
            'Empower the Current': 'passive',
            'Flash Freeze': 'reaction',
            'Heart of Ice': 'action',
            'Jumping the Falls': 'action',
            'Sapping the Strength': 'action',
            'Turning the Tide': 'reaction',
         },
         mythic: 'Whispering Blade',
         mythicFlag: 'reaction',
         mythicEffect: 'You ended <strong><em>Frost Dragon Style</em></strong> after performing <strong><em>Whispering Blade</em></strong>. The <strong>Damage</strong> it inflicted was doubled, and you may not enter <strong><em>Frost Dragon Style</em></strong> again until the start of your next turn.',
      },
      {
         name: 'Inferno Style',
         img: 'icons/magic/fire/barrier-wall-flame-ring-yellow.webp',
         channel: 'Channel the Flames',
         end: 'If you did not spend or gain any <strong>Focus</strong> during your turn, your <strong>Focus</strong> decreases by <strong>-1</strong>. The style ends if you have <strong>0 Focus</strong> at the end of your turn.',
         flags: {
            'Borrow the Flames': 'passive',
            'Burning Rebuke': 'reaction',
            'Empower the Flames': 'passive',
            'Fear no Blade': 'reaction',
            'Leaping Flame': 'reaction',
            'Ring of Fire': 'passive',
            'Scorching Thrust': 'action',
            'Sunflare Strike': 'action',
            'Superheated Strike': 'action',
            'Vengeful Flames': 'reaction',
         },
         mythic: 'Living Inferno',
         mythicFlag: 'action',
      },
      {
         name: 'Mountain King Style',
         img: 'icons/magic/earth/barrier-stone-brown-green.webp',
         channel: 'Channel the Stone',
         end: 'The style ends if you did not spend or gain <strong>Focus</strong> this turn, or have <strong>0 Focus</strong> at the end of your turn.',
         flags: {
            'Borrow the Stone': 'passive',
            'Boulder Throw': 'action',
            'Empower the Stone': 'passive',
            'Impending Avalanche': 'action',
            'Mountain King\'s Grip': 'reaction',
            'Mountain Guardian': 'reaction',
            'Pull of the Mountain': 'action',
            'The Mountain\'s Embrace': 'passive',
            'Weight of the Mountain': 'reaction',
         },
         mythic: 'Mountain Breaker',
         mythicFlag: 'action',
      },
   ];
   for (const s of STYLES) {
      const root = mkFolder(pack, 'Item', s.name, null, `${pack}-folder`);
      const abil = mkFolder(pack, 'Item', 'Abilities', root, `${pack}-folder`);
      const myth = mkFolder(pack, 'Item', 'Mythic Technique', root, `${pack}-folder`);
      const fxRoot = mkFolder('effects', 'ActiveEffect', s.name, fxMartial, 'effects-folder');
      const styleEntry = E(s.name);
      const style = mkAbility(pack, styleEntry, {
         folder: root,
         sort: 0,
         img: s.img,
         flags: {
            action: true,
         },
      });
      linkEffects(style, [mkEffect(style, s.name, fxRoot, {
         duration: {
            type: 'permanent',
         },
         description: P(`You are in <strong><em>${s.name}</em></strong>.`) + bullets(styleEntry),
         rules: [
            rollMsg(s.name, 'You may spend up to <strong>3 Focus</strong>, before or after rolling, to gain <strong>+1 bonus Expertise</strong> per <strong>Focus</strong> spent.'),
            turnMsg(s.name, `<strong>${s.channel}</strong> at the end of your turn. ${s.end}`),
         ],
      })]);
      let sort = 100000;
      for (const [title, kind] of Object.entries(s.flags)) {
         mkAbility(pack, E(title), {
            folder: abil,
            sort: (sort += 100000),
            img: s.img,
            flags: {
               [kind]: true,
            },
         });
      }
      const mythic = mkAbility(pack, E(s.mythic), {
         folder: myth,
         sort: 100000,
         img: s.img,
         flags: {
            [s.mythicFlag]: true,
         },
      });
      if (s.mythicEffect) {
         const fxMyth = mkFolder('effects', 'ActiveEffect', 'Mythic Technique', fxRoot, 'effects-folder');
         linkEffects(mythic, [mkEffect(mythic, s.mythic, fxMyth, {
            duration: {
               type: 'turnStart',
            },
            description: P(s.mythicEffect),
            rules: [],
         })]);
      }
   }
}

// ---------- 7. Rules journal ----------
{
   const journal = docs.find(({ d }) => d._key?.startsWith('!journal!')).d;
   const names = docs.filter(({ d }) => d._key.startsWith('!items!') || d._key.startsWith('!actors!')).map(({ d }) => d.name);
   const result = buildJournal(md, journal, names, (page, html) => (page === 'Conditions'
      // Approved source fix: the Stunned text repeats "Defense decrease by".
      ? html.replace(/decreases by <strong>Defense<\/strong> decrease by /, 'decreases by ')
      : html));
   for (const l of result.log) {
      L(l);
   }
   const conditions = result.journal.pages.find((p) => p.name === 'Conditions').text.content;
   if (conditions.includes('decrease by <strong>Defense</strong>') || !conditions.includes('decreases by <strong>-¼</strong> of their base value, rounded up.</p>')) {
      throw new Error('Stunned text fix did not apply');
   }
   L('SOURCE-FIX Conditions > Stunned: repeated "Defense decrease by" removed');
   Object.assign(journal, result.journal);
   markDirty('rules', journal);
}

// ---------- write ----------
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length > 0) {
   throw new Error(`${OUT} is not empty; move it to the recycle bin first.`);
}
const renames = [];
let written = 0;
for (const { pack, d } of dirty) {
   const orig = originals.get(d);
   const isNew = orig === undefined;
   if (!isNew && orig === JSON.stringify(d)) {
      continue;
   }
   if (!isNew) {
      d._stats = {
         ...d._stats,
         modifiedTime: NOW,
      };
   }
   const dir = path.join(OUT, pack);
   fs.mkdirSync(dir, {
      recursive: true,
   });
   const safe = `${d.name}`.replace(/[^A-Za-z0-9]+/g, '_');
   const file = `${safe}_${d._id}.json`;
   fs.writeFileSync(path.join(dir, file), `${JSON.stringify(d, null, 2)}\n`);
   written++;
   const src = docs.find((x) => x.d === d);
   if (src && path.basename(src.f) !== file) {
      renames.push(`${path.relative(SRC_PACKS, src.f)}\t${pack}/${file}`);
   }
}
fs.writeFileSync(path.join(OUT, '..', 'renames.txt'), renames.join('\n'));
fs.writeFileSync(path.join(OUT, '..', 'log.txt'), log.join('\n'));
console.log(log.join('\n'));
console.log(`\n${written} documents written to ${OUT}; ${renames.length} renamed.`);
