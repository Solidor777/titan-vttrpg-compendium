// Stage 1: reconciles the extracted v11 module packs (src-orig) with the rules markdown: deletions, renames,
// descriptions, traits, rarity, values, weapon attacks, armor, and spells. Writes reconcile-state.json.
import fs from 'node:fs';
import path from 'node:path';
import {
   parseEntries,
   loadDocs,
   key,
   norm,
   htmlText,
   mdText,
   mdToHtml,
   wdiff,
   splitPackDescription,
} from '../../rules/lib.mjs';
import { uuid } from './ids.mjs';
import { STAGE, readRules } from './stage.mjs';

const entries = parseEntries(readRules());
const docs = loadDocs(path.join(STAGE, 'src-orig'));
const log = [];
const L = (...a) => log.push(a.join(' '));

// ---------- helpers ----------
const escHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fieldP = (label, value) => `<p><strong>${escHtml(label)}:</strong> ${escHtml(value)}</p>`;
const hdr = (e, label) => e.header.find((h) => h.label.toLowerCase() === label.toLowerCase())?.value;
const splitList = (v) => (v ? v.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean) : []);

// Pack -> root section of new.md.
const PACK_ROOT = {
   abilities: 'Abilities',
   'armor-and-shields': 'Equipment',
   weapons: 'Equipment',
   spells: 'The Arcane Arts',
   'sacred-arts': 'The Sacred Arts',
   'urderic-items': 'Urderic Equipment',
   summons: 'The Sacred Arts',
};

// Pack items that no longer exist in the rules.
const DELETE = new Set([
   'abilities:Crushing Grip',
   'abilities:Helpful',
   'abilities:Immense Strikes',
   'abilities:Master of Disguise',
   'abilities:Meditative Casting',
   'urderic-items:Urderic Air-Mine',
   'urderic-items:Urderic Aetherflow Adjuster',
   'urderic-items:Urderic Aether-Lense',
   'urderic-items:Urderic Exoskeleton',
   'urderic-items:Urderic Net Launcher',
   'urderic-items:Urderic Nullifier',
   'urderic-items:Urderic Reactive Plating',
   'urderic-items:Urderic Rebreather',
   'urderic-items:Urderic Void Field',
   'urderic-items:Urderic Wings',
   'urderic-items:Ur-stone Harness',
   'urderic-items:Urderic Aetherflow Adjuster (Aim Assistance)',
   'urderic-items:Urderic Aetherflow Adjuster (Alertness)',
   'urderic-items:Urderic Aetherflow Adjuster (Evasion)',
   'weapons:Improvised Weapon',
   // Duplicate of the system's own "Dodging" effect in titan.effects.
   'effects:Dodge (Effect)',
]);

// Renames to the rules' names; the "(Choose)", "(Rank I)", "(N/N)" and "(1)" instance suffixes are kept.
const RENAME = {
   'Dust Cloak': 'Dust Storm',
   'Cleansing Touch': 'Cleaning Touch',
   'Combat Assesment': 'Combat Assessment',
   'Observent (Choose)': 'Observant (Choose)',
   Observent: 'Observant',
   'Blesssing of the Arbiter': 'Blessing of the Arbiter',
   'Path of the Veiled Moon': 'Path of Veiled Moon',
   'Titan Urderic Armor (6/6)': 'Urderic Titan Armor (4/4)',
   'Urderic Titan Armor (6/6)': 'Urderic Titan Armor (4/4)',
};

// Rules-document typos: keep the existing (correct) pack body for these; reported for the author.
const KEEP_PACK_BODY = {
   'The Dragon Devours': 'rules text reads "a alliny es" (typo for "any allies")',
   'Path of the Horned Kirin': 'rules text reads "stronwg" (typo for "strong")',
   'Powerful Blasts': 'rules text reads "Blast,each" (missing space)',
   Sword: 'rules body is the Quarterstaff description (copy-paste error); kept the Sword description',
};

function baseName(n) {
   return n
      .replace(/\s*\((Choose|Rank I|\d+\/\d+|\d+)\)\s*$/i, '')
      .replace('Assesment', 'Assessment')
      .replace('Observent', 'Observant')
      .replace('Blesssing', 'Blessing')
      .replace('Path of the Veiled Moon', 'Path of Veiled Moon')
      .replace('Dust Cloak', 'Dust Storm')
      .replace('Cleansing Touch', 'Cleaning Touch');
}

const byKey = new Map();
for (const e of entries) {
   const k = key(e.title);
   if (!byKey.has(k)) {
      byKey.set(k, []);
   }
   byKey.get(k).push(e);
}
function findEntry(pack, name, packText) {
   const cands = (byKey.get(key(baseName(name))) ?? []).filter((c) => c.path[0] === PACK_ROOT[pack]);
   let best = null;
   for (const c of cands) {
      const n = wdiff(packText, mdText(c.body)).length;
      if (!best || n < best.n) {
         best = {
            c,
            n,
         };
      }
   }
   return best?.c;
}

// ---------- description ----------
const HEADER_IN_DESC = {
   ability: ['Requirements', 'Cost', 'Range', 'Area'],
   spell: ['Requirements', 'Cost'],
   weapon: ['Requirements', 'Power Consumption'],
   armor: ['Requirements', 'Power Capacity'],
   shield: ['Requirements'],
   equipment: ['Requirements', 'Power Consumption', 'Power Capacity'],
   commodity: ['Requirements'],
};
function buildDescription(d, e) {
   const { rest } = splitPackDescription(d.system.description ?? '');
   const allowed = HEADER_IN_DESC[d.type] ?? [];
   const headerHtml = e.header.filter((h) => allowed.includes(h.label)).map((h) => fieldP(h.label, h.value)).join('');
   const mdBody = mdText(e.body);
   const same = htmlText(rest) === mdBody;
   let body;
   if (same || KEEP_PACK_BODY[d.name]) {
      body = rest.replace(/<p>\s*<\/p>/g, '');
      if (!same) {
         L(`KEPT-PACK-BODY ${d.name}: ${KEEP_PACK_BODY[d.name]}`);
      }
   }
   else {
      body = mdToHtml(e.body);
      L(`BODY-UPDATED ${d.name}\n${wdiff(htmlText(rest), mdBody).join('\n')}`);
   }
   return headerHtml + body;
}

// ---------- traits ----------
// Rules-document trait inconsistencies corrected to the form every sibling entry uses (reported for the author).
const TRAIT_FIXES = {
   'Light Attunement': (n) => (n.includes('Attunement') ? n : [...n, 'Attunement']),
   'Path of Black Flames': (n) => n.map((t) => (t === 'Black Flames' ? 'Black Flame' : t)),
};
function setCustomTraits(d, names, seed) {
   if (TRAIT_FIXES[d.name]) {
      const fixed = TRAIT_FIXES[d.name](names);
      if (fixed.join() !== names.join()) {
         L(`HEADER-ERROR ${d.name}: traits [${names}] corrected to [${fixed}]`);
      }
      names = fixed;
   }
   const old = d.system.customTrait ?? [];
   const next = names.map((n) => {
      const prev = old.find((t) => key(t.name) === key(n));
      return prev ?? {
         name: n,
         description: '',
         uuid: uuid(`${seed}:trait:${n}`),
      };
   });
   const before = old.map((t) => t.name).join(', ');
   const after = next.map((t) => t.name).join(', ');
   if (before !== after) {
      L(`TRAITS ${d.name}: [${before}] -> [${after}]`);
   }
   d.system.customTrait = next;
}

const RARITIES = ['common', 'uncommon', 'rare', 'unique'];
function setRarity(d, value, why) {
   const r = value?.toLowerCase();
   if (!RARITIES.includes(r)) {
      if (value) {
         L(`WARN rarity "${value}" unparsed for ${d.name}`);
      }
      return;
   }
   if (d.system.rarity !== r) {
      L(`RARITY ${d.name}: ${d.system.rarity} -> ${r} (${why})`);
      d.system.rarity = r;
   }
}

const ATTACK_TRAIT_NAMES = {
   blast: 'blast',
   cleave: 'cleave',
   close: 'close',
   crushing: 'crushing',
   ineffective: 'ineffective',
   loud: 'loud',
   magical: 'magical',
   flurry: 'flurry',
   penetrating: 'penetrating',
   piercing: 'piercing',
   push: 'push',
   reload: 'reload',
   rend: 'rend',
   restraining: 'restraining',
   slashing: 'slashing',
   splash: 'splash',
   twohanded: 'twoHanded',
   vicious: 'vicious',
};
function parseAttackTraits(list, seed, oldCustom = []) {
   const trait = [];
   const customTrait = [];
   for (const raw of splitList(list)) {
      const m = raw.match(/^(.*?)\s*\(?\s*(\d+)?\s*\)?$/);
      const k = key(m[1]);
      if (ATTACK_TRAIT_NAMES[k]) {
         trait.push({
            name: ATTACK_TRAIT_NAMES[k],
            value: k === 'blast' ? Number(m[2] ?? 0) : true,
         });
      }
      else {
         customTrait.push(oldCustom.find((t) => key(t.name) === key(raw)) ?? {
            name: raw,
            description: '',
            uuid: uuid(`${seed}:atrait:${raw}`),
         });
      }
   }
   return {
      trait,
      customTrait,
   };
}
const traitSig = (t) => t.map((x) => `${x.name}=${x.value}`).sort().join(',');

function parseDamage(v) {
   const m = v?.match(/^(\d+)\s*(\+\s*ES)?/i);
   return m ? {
      damage: Number(m[1]),
      plusExtraSuccessDamage: Boolean(m[2]),
   } : null;
}
const parseRange = (v) => {
   const m = v?.match(/^(\d+)/);
   return m ? Number(m[1]) : null;
};

function reconcileAttack(d, atk, fields, seed, label) {
   const f = (l) => fields.find((x) => x.label === l)?.value;
   const dmg = parseDamage(f('Damage'));
   if (dmg && (atk.damage !== dmg.damage || atk.plusExtraSuccessDamage !== dmg.plusExtraSuccessDamage)) {
      L(`DAMAGE ${d.name}/${label}: ${atk.damage}${atk.plusExtraSuccessDamage ? '+ES' : ''} -> ${dmg.damage}${dmg.plusExtraSuccessDamage ? '+ES' : ''}`);
      Object.assign(atk, dmg);
   }
   const r = parseRange(f('Range')) ?? atk.range;
   if (atk.range !== r) {
      L(`RANGE ${d.name}/${label}: ${atk.range} -> ${r}`);
      atk.range = r;
   }
   if (f('Traits') !== undefined) {
      const { trait, customTrait } = parseAttackTraits(f('Traits'), `${seed}:${label}`, atk.customTrait);
      if (traitSig(trait) !== traitSig(atk.trait ?? []) ||
         customTrait.map((t) => t.name).join() !== (atk.customTrait ?? []).map((t) => t.name).join()) {
         L(`ATTACK-TRAITS ${d.name}/${label}: [${traitSig(atk.trait ?? [])}|${(atk.customTrait ?? []).map((t) => t.name)}] -> [${traitSig(trait)}|${customTrait.map((t) => t.name)}]`);
      }
      atk.trait = trait;
      atk.customTrait = customTrait;
   }
}

function setValue(d, e) {
   const v = hdr(e, 'Value');
   if (v !== undefined) {
      const n = Number(v.replace(/[^\d]/g, ''));
      if (d.system.value !== n) {
         L(`VALUE ${d.name}: ${d.system.value} -> ${n}`);
         d.system.value = n;
      }
   }
}

// ---------- spells ----------
const RATINGS = ['awareness', 'accuracy', 'defense', 'initiative', 'melee'];
const RESISTANCES = ['reflexes', 'resilience', 'willpower'];
const ATTRS = ['body', 'mind', 'soul'];
const SKILLS = {
   arcana: 'arcana',
   athletics: 'athletics',
   deception: 'deception',
   dexterity: 'dexterity',
   diplomacy: 'diplomacy',
   engineering: 'engineering',
   intimidation: 'intimidation',
   investigation: 'investigation',
   lore: 'lore',
   medicine: 'medicine',
   meleeweapons: 'meleeWeapons',
   metaphysics: 'metaphysics',
   nature: 'nature',
   perception: 'perception',
   performance: 'performance',
   rangedweapons: 'rangedWeapons',
   subterfuge: 'subterfuge',
   stealth: 'stealth',
};
const SPEEDS = {
   flyspeed: 'fly',
   swimspeed: 'swim',
   burrowspeed: 'burrow',
   stridespeed: 'stride',
};
function parseEnhancements(v) {
   // Splits "A (1 + ES), B (5 + ES / 2)" on top-level commas.
   const out = [];
   let depth = 0;
   let cur = '';
   for (const ch of v ?? '') {
      if (ch === '(') {
         depth++;
      }
      if (ch === ')') {
         depth--;
      }
      if ((ch === ',' && depth === 0)) {
         out.push(cur.trim());
         cur = '';
         continue;
      }
      cur += ch;
   }
   if (cur.trim()) {
      out.push(cur.trim());
   }
   return out.map((s) => {
      const m = s.match(/^(.*?)\s*\((.*)\)\s*$/);
      if (!m) {
         return {
            name: s,
            raw: s,
         };
      }
      const inner = m[2];
      const iv = inner.match(/^\s*([+-]?\d+)/);
      const cost = inner.match(/\/\s*(\d+)/);
      return {
         name: m[1].trim(),
         initialValue: iv ? Number(iv[1]) : 0,
         scalingCost: cost ? Number(cost[1]) : 1,
         raw: s,
         inner,
      };
   });
}
function stdScaling(label, extra) {
   return {
      label,
      scaling: true,
      enabled: true,
      ...extra,
   };
}
function mapEnhancement(enh, old, seed) {
   const k = key(enh.name);
   const findOld = (label, pred = () => true) => old.find((a) => a.label === label && pred(a));
   const withOld = (label, pred, fresh) => {
      const prev = findOld(label, pred);
      return {
         ...(prev ? structuredClone(prev) : {}),
         ...fresh,
      };
   };
   if (k === 'rounds' || k === 'round' || k === 'minutes') {
      const unit = k === 'minutes' ? 'minutes' : 'rounds';
      return withOld('duration', () => true, stdScaling('duration', {
         unit,
         initialValue: enh.initialValue,
         cost: unit === 'minutes' ? 4 : 1,
         scalingCost: enh.scalingCost,
      }));
   }
   if (k === 'damage') {
      return withOld('damage', () => true, stdScaling('damage', {
         initialValue: enh.initialValue,
         isDamage: true,
         scalingCost: enh.scalingCost,
         option: findOld('damage')?.option ?? [],
         resistanceCheck: findOld('damage')?.resistanceCheck ?? 'none',
      }));
   }
   if (k === 'healing') {
      return withOld('healing', () => true, stdScaling('healing', {
         initialValue: enh.initialValue,
         isHealing: true,
         scalingCost: enh.scalingCost,
      }));
   }
   if (k === 'targets') {
      return withOld('extraTargets', () => true, stdScaling('extraTargets', {
         initialValue: 0,
         cost: 1,
         scalingCost: enh.scalingCost,
      }));
   }
   const multi = (names) => names.map((n) => key(n));
   const parts = multi(enh.name.split(/\s+and\s+/i));
   if (parts.every((p) => RATINGS.includes(p))) {
      return withOld('increaseRating', () => true, stdScaling('increaseRating', {
         initialValue: enh.initialValue,
         option: parts,
         scalingCost: enh.scalingCost,
      }));
   }
   if (k === 'defensepenalty') {
      return withOld('decreaseRating', () => true, stdScaling('decreaseRating', {
         initialValue: enh.initialValue,
         option: ['defense'],
         scalingCost: enh.scalingCost,
      }));
   }
   if (k === 'willpowerpenalty') {
      return withOld('decreaseResistance', () => true, stdScaling('decreaseResistance', {
         initialValue: Math.abs(enh.initialValue),
         option: ['willpower'],
         scalingCost: enh.scalingCost,
      }));
   }
   if (parts.every((p) => RESISTANCES.includes(p))) {
      return withOld('increaseResistance', () => true, stdScaling('increaseResistance', {
         initialValue: enh.initialValue,
         option: parts,
         scalingCost: enh.scalingCost,
      }));
   }
   if (k === 'armor' || k === 'damagebonus') {
      return withOld('increaseMod', () => true, stdScaling('increaseMod', {
         initialValue: enh.initialValue,
         option: [k === 'armor' ? 'armor' : 'damage'],
         scalingCost: enh.scalingCost,
      }));
   }
   if (parts.every((p) => ATTRS.includes(p))) {
      return withOld('increaseAttribute', () => true, stdScaling('increaseAttribute', {
         initialValue: enh.initialValue,
         option: parts,
         scalingCost: enh.scalingCost,
      }));
   }
   if (parts.every((p) => SKILLS[p])) {
      return withOld('increaseSkill', () => true, stdScaling('increaseSkill', {
         initialValue: enh.initialValue,
         option: parts.map((p) => SKILLS[p]),
         scalingCost: enh.scalingCost,
      }));
   }
   if (SPEEDS[k]) {
      return withOld('increaseSpeed', () => true, stdScaling('increaseSpeed', {
         initialValue: enh.initialValue,
         option: [SPEEDS[k]],
         scalingCost: enh.scalingCost,
      }));
   }
   return null;
}
function customAspect(label, initialValue, scaling, cost, seed, old) {
   const prev = old.find((a) => key(a.label) === key(label));
   return {
      resistanceCheck: 'none',
      isDamage: false,
      isHealing: false,
      ...(prev ? structuredClone(prev) : {}),
      label,
      scaling,
      initialValue,
      cost,
      uuid: prev?.uuid ?? uuid(`${seed}:caspect:${label}`),
   };
}
// Spells whose rules-document header (Range/Area/Enhancements) contradicts the spell's own body text.
// 'keep' = body matches the existing aspects; other values patch one field of the header-derived aspects.
const SPELL_HEADER_ERRORS = {
   'Aether Attunement': 'keep',
   'The Penumbral Spear': 'keep',
   'Void Attunement': 'keep',
   'Void Field': 'keep',
   'Call Tornado': 'keep',
   'Whisper on the Wind': 'keep',
   Strike: 'keep',
   'Shape Earth': 'keep',
   Shockwave: 'keep',
   Firejump: 'keep',
   'Fire Attunement': 'keep',
   'Fire Cloak': 'keep',
   'Bone Storm': 'keep',
   'Claws and Fangs': 'keep',
   'Diamond Skin': 'keep',
   'Hybrid Form': 'keep',
   'Mend Flesh': 'keep',
   'Arrow Ward': 'keep',
   'Wall of Force': 'keep',
   'Shape Metal': 'keep',
   'Truth-Sight': 'keep',
   'Stoke Rage': 'keep',
   'Cleansing Shroud': 'keep',
   'Icicle Shower': 'keep',
   'Swim through the Waves': 'keep',
   'Tidal Surge': 'keep',
   'Fruits of Longevity': 'keep',
   'Shape Forest': 'keep',
   'Wood Attunement': 'keep',
   'Wall of Stone': 'dropRadius',
   'Wall of Fire': 'dropRadius',
   'Brilliant Lance': 'packRange',
   'Will-Breaker': 'packRange',
   'Infiltrate Dreams': 'addRange10',
};
const traditionRarity = {};
for (const e of entries) {
   if (e.path.join('>') === 'The Arcane Arts>Spell Traditions' && e.level === 3) {
      traditionRarity[e.title] = (hdr(e, 'Rarity') ?? e.body.find((l) => /Rarity:/.test(l))?.replace(/.*Rarity:\**\s*/, ''))?.trim();
   }
}
function reconcileSpell(d, e, tradition) {
   const s = d.system;
   const seed = d._id;
   // Casting check: the rules list a fixed DC per spell.
   const dc = hdr(e, 'DC')?.match(/^(\w+)\s*\((.*?)\)\s*(\d+):(\d+)$/);
   if (dc) {
      const next = {
         attribute: dc[1].toLowerCase(),
         skill: SKILLS[key(dc[2])] ?? key(dc[2]),
         difficulty: Number(dc[3]),
         complexity: Number(dc[4]),
         autoCalculateDC: false,
      };
      const prev = s.castingCheck;
      if (prev.difficulty !== next.difficulty || prev.complexity !== next.complexity || prev.autoCalculateDC ||
         prev.attribute !== next.attribute || prev.skill !== next.skill) {
         L(`DC ${d.name}: ${prev.attribute}/${prev.skill} ${prev.difficulty}:${prev.complexity} auto=${prev.autoCalculateDC} -> ${next.difficulty}:${next.complexity} fixed`);
      }
      s.castingCheck = next;
   }
   else {
      L(`WARN no DC for spell ${d.name}`);
   }
   // Tradition, traits, rarity.
   if (s.tradition !== tradition) {
      L(`TRADITION ${d.name}: ${s.tradition} -> ${tradition}`);
      s.tradition = tradition;
   }
   if (hdr(e, 'Traits') !== undefined) {
      setCustomTraits(d, splitList(hdr(e, 'Traits')).filter((t) => key(t) !== key(tradition)), seed);
   }
   else {
      L(`HEADER-ERROR ${d.name}: rules header has no Traits line; kept traits`);
   }
   setRarity(d, hdr(e, 'Rarity') ?? traditionRarity[tradition], hdr(e, 'Rarity') ? 'rules' : `tradition ${tradition}`);

   // Aspects.
   const oldStd = s.aspect ?? [];
   const oldCustom = s.customAspect ?? [];
   const std = [];
   const custom = [];
   const range = hdr(e, 'Range');
   if (range) {
      const r = range.toLowerCase();
      const n = parseRange(r);
      const prev = oldStd.find((a) => a.label === 'range');
      if (r.startsWith('self') || r.startsWith('touch')) {
         std.push({
            ...(prev ?? {}),
            label: 'range',
            initialValue: r.startsWith('self') ? 'self' : 'touch',
            enabled: true,
         });
      }
      else if ([10, 30, 50].includes(n)) {
         std.push({
            ...(prev ?? {}),
            label: 'range',
            initialValue: n,
            enabled: true,
         });
      }
      else if (n !== null) {
         custom.push(customAspect('Range', n, false, 0, seed, oldCustom));
      }
      else {
         L(`WARN unparsed range "${range}" for ${d.name}`);
      }
   }
   for (const part of splitList(hdr(e, 'Area')?.replace(/,?\s+or\s+/g, ', '))) {
      const m = part.match(/^(\d+)\s*-?\s*space\s*-?\s*(radius|line|cone)/i);
      if (!m) {
         L(`WARN unparsed area "${part}" for ${d.name}`);
         continue;
      }
      const n = Number(m[1]);
      const shape = m[2].toLowerCase();
      if (shape === 'radius' && (n === 5 || n === 10)) {
         const prev = oldStd.find((a) => a.label === 'radius');
         std.push({
            ...(prev ?? {}),
            label: 'radius',
            initialValue: n,
            enabled: true,
         });
      }
      else {
         custom.push(customAspect(shape[0].toUpperCase() + shape.slice(1), n, false, 0, seed, oldCustom));
      }
   }
   for (const enh of parseEnhancements(hdr(e, 'Enhancements'))) {
      const mapped = mapEnhancement(enh, oldStd, seed);
      if (mapped) {
         std.push(mapped);
      }
      else if (enh.initialValue !== undefined) {
         custom.push(customAspect(enh.name, enh.initialValue, true, enh.scalingCost, seed, oldCustom));
      }
      else {
         // Non-numeric enhancement such as "Duration" or "Magic Damage Reduction": a scaling custom aspect.
         custom.push(customAspect(enh.name, 0, true, 1, seed, oldCustom));
      }
   }
   // Preserve non-scaling mechanics derived from the body (conditions, custom effects).
   for (const a of oldStd) {
      if (['inflictCondition', 'removeCondition'].includes(a.label) ||
         (!a.scaling && !['range', 'radius'].includes(a.label))) {
         std.push(a);
      }
   }
   for (const a of oldCustom) {
      if (!a.scaling && !['range', 'line', 'cone'].includes(key(a.label)) && !custom.some((c) => key(c.label) === key(a.label))) {
         custom.push(a);
      }
   }
   const sig = (arr) => arr.map((a) => `${a.label}${a.unit ? ':' + a.unit : ''}=${JSON.stringify(a.initialValue)}${a.option?.length ? '[' + a.option + ']' : ''}${a.scaling ? '/' + (a.scalingCost ?? a.cost) : ''}`).sort().join(' ');
   const before = `${sig(oldStd)} | ${sig(oldCustom)}`;
   const after = `${sig(std)} | ${sig(custom)}`;
   const why = SPELL_HEADER_ERRORS[d.name];
   if (why === 'keep') {
      L(`ASPECTS-KEPT ${d.name}: rules header conflicts with the spell's own body text; body agrees with existing aspects`);
      L(`HEADER-ERROR ${d.name}`);
      return;
   }
   if (why === 'dropRadius') {
      const i = std.findIndex((a) => a.label === 'radius');
      if (i >= 0) {
         std.splice(i, 1);
      }
      L(`HEADER-ERROR ${d.name}: header area "5-space-radius" contradicts body (circle radius 1-2 spaces); omitted`);
   }
   if (why === 'packRange') {
      const i = std.findIndex((a) => a.label === 'range');
      const prev = oldStd.find((a) => a.label === 'range');
      if (i >= 0 && prev) {
         std[i] = prev;
      }
      L(`HEADER-ERROR ${d.name}: header range contradicts body; kept range ${JSON.stringify(prev?.initialValue)}`);
   }
   if (why === 'addRange10') {
      s.aspect = [
         {
            label: 'range',
            initialValue: 10,
            enabled: true,
         },
         ...oldStd,
      ];
      s.customAspect = oldCustom;
      L(`ASPECTS ${d.name}: kept existing aspects, added range 10 (header and body agree)`);
      return;
   }
   if (before !== after) {
      L(`ASPECTS ${d.name}:\n    old: ${before}\n    new: ${after}`);
   }
   s.aspect = std;
   s.customAspect = custom;
}

// ---------- main item pass ----------
const out = {};
const push = (pack, doc) => {
   (out[pack] ??= []).push(doc);
};
const itemByOldName = {};
const packFolders = {};
for (const { pack, d } of docs) {
   if (d._key.startsWith('!folders!')) {
      (packFolders[pack] ??= []).push(d);
   }
}
const folderName = (pack, id) => packFolders[pack]?.find((f) => f._id === id);
function folderPath(pack, id) {
   const names = [];
   let f = folderName(pack, id);
   while (f) {
      names.unshift(f.name);
      f = folderName(pack, f.folder);
   }
   return names;
}

const effectItems = [];
for (const { pack, d } of docs) {
   if (d._key.startsWith('!folders!') || d._key.startsWith('!journal!')) {
      continue;
   }
   if (DELETE.has(`${pack}:${d.name}`)) {
      L(`DELETED [${pack}] ${d.name}`);
      continue;
   }
   if (d.type === 'effect') {
      effectItems.push({
         pack,
         d,
      });
      continue;
   }
   if (d._key.startsWith('!actors!')) {
      push(pack, d);
      continue;
   }
   const oldName = d.name;
   const { rest } = splitPackDescription(d.system.description ?? '');
   const e = findEntry(pack, d.name, htmlText(rest));
   if (!e) {
      L(`NO-RULES-ENTRY (kept unchanged) [${pack}] ${d.name}`);
      push(pack, d);
      itemByOldName[oldName] = d;
      continue;
   }
   if (RENAME[d.name]) {
      L(`RENAMED ${d.name} -> ${RENAME[d.name]}`);
      d.name = RENAME[d.name];
   }
   d.system.description = buildDescription(d, e);
   delete d.system.requirements;
   delete d.system.multiAttack;

   const seed = d._id;
   if (d.type === 'ability') {
      if (hdr(e, 'Traits') !== undefined) {
         setCustomTraits(d, splitList(hdr(e, 'Traits')), seed);
      }
      setRarity(d, hdr(e, 'Rarity'), 'rules');
   }
   else if (d.type === 'spell') {
      const tradition = e.path[2];
      reconcileSpell(d, e, tradition === 'Light' && d.name === 'Cleansing Light' ? 'Light' : tradition);
   }
   else if (d.type === 'weapon') {
      setValue(d, e);
      setRarity(d, hdr(e, 'Rarity'), 'rules');
      const atks = d.system.attack;
      if (e.attacks.length) {
         e.attacks.forEach((a, i) => {
            const label = a.name.replace(/\s*\(.*\)\s*$/, '');
            const atk = atks.find((x) => key(x.label) === key(label)) ?? atks[i];
            if (!atk) {
               L(`WARN missing attack ${a.name} on ${d.name}`);
               return;
            }
            reconcileAttack(d, atk, a.fields, seed, label);
         });
      }
      else if (atks.length === 1) {
         const fields = e.header.filter((h) => ['Damage', 'Range', 'Traits'].includes(h.label));
         if (!hdr(e, 'Damage')) {
            L(`NOTE ${d.name}: rules omit Damage; kept ${atks[0].damage}${atks[0].plusExtraSuccessDamage ? '+ES' : ''}`);
         }
         reconcileAttack(d, atks[0], fields, seed, atks[0].label);
      }
   }
   else if (d.type === 'armor') {
      setValue(d, e);
      const a = parseRange(hdr(e, 'Armor'));
      if (a !== null && (d.system.armor.max !== a || d.system.armor.value !== a)) {
         L(`ARMOR ${d.name}: ${d.system.armor.max} -> ${a}`);
         d.system.armor = {
            max: a,
            value: a,
         };
      }
      const { trait } = parseAttackTraits('', seed);
      const names = splitList(hdr(e, 'Traits')).map((t) => key(t));
      const next = ['magical', 'loud', 'encumbering', 'heavy'].filter((n) => names.includes(n)).map((n) => ({
         name: n,
         value: true,
      }));
      if (hdr(e, 'Traits') === undefined) {
         next.splice(0, next.length, ...(d.system.trait ?? []));
      }
      if (traitSig(next) !== traitSig(d.system.trait ?? [])) {
         L(`ARMOR-TRAITS ${d.name}: [${traitSig(d.system.trait ?? [])}] -> [${traitSig(next)}]`);
      }
      d.system.trait = next;
      void trait;
   }
   else if (d.type === 'shield') {
      setValue(d, e);
      const def = hdr(e, 'Defense Bonus')?.match(/(\d+)/);
      if (def && d.system.defense !== Number(def[1])) {
         L(`DEFENSE ${d.name}: ${d.system.defense} -> ${def[1]}`);
         d.system.defense = Number(def[1]);
      }
      const names = splitList(hdr(e, 'Traits')).map((t) => key(t));
      d.system.trait = names.includes('magical') ? [{
         name: 'magical',
         value: true,
      }] : [];
   }
   else {
      setValue(d, e);
   }
   push(pack, d);
   itemByOldName[oldName] = d;
}

fs.writeFileSync(path.join(STAGE, 'reconcile-state.json'), JSON.stringify({
   out,
   effectItems,
   packFolders,
   itemIdsByOldName: Object.fromEntries(Object.entries(itemByOldName).map(([k, v]) => [k, {
      _id: v._id,
      name: v.name,
      pack: Object.keys(out).find((p) => out[p].includes(v)),
   }])),
}, null, 1));
fs.writeFileSync(path.join(STAGE, 'reconcile-log.txt'), log.join('\n'));
const counts = {};
for (const l of log) {
   const k = l.split(' ')[0];
   counts[k] = (counts[k] ?? 0) + 1;
}
console.log(counts);
