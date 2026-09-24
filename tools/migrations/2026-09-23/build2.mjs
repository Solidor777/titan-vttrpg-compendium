// Stage 2: effect conversion, derived-weapon fixes, item->effect links. Reads reconcile-state.json, writes stage2.json.
import fs from 'node:fs';
import path from 'node:path';
import { key } from '../../rules/lib.mjs';
import { STAGE } from './stage.mjs';
import { makeId, uuid } from './ids.mjs';

const state = JSON.parse(fs.readFileSync(path.join(STAGE, 'reconcile-state.json'), 'utf8'));
const { out, effectItems, packFolders } = state;
const log = [];
const L = (...a) => log.push(a.join(' '));
const MODULE = 'titan-vttrpg-compendium';

// ---------- derived weapon fix ----------
for (const d of out.spells) {
   if (d.name === 'Grasping Tendril (Weapon)') {
      d.system.attack[0].trait = [
         {
            name: 'magical',
            value: true,
         },
         {
            name: 'restraining',
            value: true,
         },
         {
            name: 'crushing',
            value: true,
         },
      ];
      L('ATTACK-TRAITS Grasping Tendril (Weapon): [flurry,magical,piercing,rend] -> [magical,restraining,crushing] (spell text)');
   }
}

// ---------- effects ----------
const PACK_LABEL = {
   abilities: 'Abilities',
   'sacred-arts': 'Sacred Arts',
   spells: 'Spells',
   'urderic-items': 'Urderic Items',
};
const EFFECT_RENAME = {
   'Echoing Attunment (Effect) (0 Charges)': 'Echoing Attunement (0 Charges)',
   'Reinforce Metal (Armor, Effect)': 'Reinforce Metal (Armor)',
   'Reinforce Metal (Weapon, Effect)': 'Reinforce Metal (Weapon)',
   'Cleansing Shroud (Effect) (Choose)': 'Cleansing Shroud (Choose)',
   'Dust Cloak (Effect)': 'Dust Storm',
   'Path of the Veiled Moon (Effect)': 'Path of Veiled Moon',
   'Swim through the Earth (Effect)': 'Swim Through the Earth',
};
// Effect base name -> owning item name, where the effect name differs from the item name.
const EFFECT_OWNER = {
   'Enlarge Creature': 'Enlarge / Reduce Creature',
   'Reduce Creature': 'Enlarge / Reduce Creature',
   'Force Speed': 'Force Speed / Slow',
   'Force Slow': 'Force Speed / Slow',
   'Astral Cloak': 'Astral / Umbral Cloak',
   'Umbral Cloak': 'Astral / Umbral Cloak',
};
const folderById = (pack, id) => packFolders[pack]?.find((f) => f._id === id);
function folderPath(pack, id) {
   const names = [];
   let f = folderById(pack, id);
   while (f) {
      names.unshift(f.name);
      f = folderById(pack, f.folder);
   }
   return names;
}
const effectFolders = new Map();
function ensureFolder(names) {
   let parent = null;
   for (let i = 0; i < names.length; i++) {
      const p = names.slice(0, i + 1).join('/');
      if (!effectFolders.has(p)) {
         const id = makeId(`effects-folder:${p}`);
         effectFolders.set(p, {
            _id: id,
            _key: `!folders!${id}`,
            name: names[i],
            type: 'ActiveEffect',
            folder: parent,
            sorting: 'a',
            sort: 0,
            color: null,
            description: '',
            flags: {},
         });
      }
      parent = effectFolders.get(p)._id;
   }
   return parent;
}
const effects = [];
for (const { pack, d } of effectItems) {
   const name = EFFECT_RENAME[d.name] ?? d.name.replace(/\s*\(Effect\)\s*$/, '');
   const s = d.system;
   const rawActive = s.active ?? true;
   const active = typeof rawActive === 'string' ? rawActive === 'true' : Boolean(rawActive);
   const folder = ensureFolder([PACK_LABEL[pack], ...folderPath(pack, d.folder)]);
   const ae = {
      _id: d._id,
      _key: `!effects!${d._id}`,
      name,
      type: 'effect',
      img: d.img,
      description: s.description ?? '',
      disabled: s.duration?.type === 'permanent' ? !active : false,
      transfer: false,
      origin: null,
      statuses: [],
      changes: [],
      folder,
      sort: d.sort ?? 0,
      flags: {},
      system: {
         duration: s.duration,
         check: s.check ?? [],
         customTrait: s.customTrait ?? [],
         rulesElement: (s.rulesElement ?? []).map(({ type, ...re }) => re),
      },
      _stats: d._stats,
   };
   effects.push(ae);
   if (name !== d.name) {
      L(`EFFECT ${d.name} -> ${name}`);
   }
}

// ---------- effect text sync with the updated rules text ----------
// Each entry: literal [from, to] replacements applied to the description and every rules-element message,
// plus optional rules-element removals by predicate.
function setValue(ae, operation, selector, k, value) {
   const re = ae.system.rulesElement.find((r) => r.operation === operation && r.selector === selector && r.key === k);
   if (!re) {
      throw new Error(`${ae.name}: no ${operation}.${selector}.${k}`);
   }
   re.value = value;
}
const EFFECT_FIXES = {
   'Echoing Attunement (0 Charges)': {
      replace: [['you may reduce to <strong>Difficulty</strong>', 'you may reduce the <strong>Difficulty</strong>']],
   },
   'Presence of the Arbiter': {
      replace: [['<p>You can spend <strong>1 Resolve</strong> at the start of your turn to sustain this effect.</p>', '']],
      remove: (re) => re.operation === 'turnMessage',
   },
   "Blue Spirit's Magical Bulwark": {
      replace: [['at the start your turn', 'at the start of your turn']],
   },
   'Crowned Kirin': {
      replace: [['would have inflicted the takes', 'would have inflicted it takes']],
   },
   "Fox's Cunning": {
      replace: [["Fox's Conning", "Fox's Cunning"]],
   },
   'Watery Grave': {
      replace: [['opposed <strong>Reflexes</strong>', 'opposed <strong>Resilience</strong>'], ['opposed Reflexes', 'opposed Resilience']],
   },
   'Call Tornado': {
      replace: [[' You take <strong>1 Damage</strong> that ignores <strong>Armor</strong> at the start of your turn, as you are buffeted around by the swirling winds.', '']],
      remove: (re) => re.operation === 'persistentDamage' || re.operation === 'turnMessage',
   },
   // Rules-element values that contradicted the effect's own (and the rules') text.
   'Air Attunement': {
      transform: (ae) => setValue(ae, 'flatModifier', 'training', 'dexterity', 1),
   },
   'Force Slow': {
      transform: (ae) => {
         const re = ae.system.rulesElement.find((r) => r.selector === 'speed' && r.key === 'swim');
         re.operation = 'mulBase';
         re.value = 0.5;
      },
   },
   'Enlarge Creature': {
      transform: (ae) => setValue(ae, 'flatModifier', 'training', 'stealth', -3),
   },
   'Reduce Creature': {
      transform: (ae) => setValue(ae, 'flatModifier', 'attribute', 'body', -1),
   },
   'Swim through the Waves': {
      transform: (ae) => setValue(ae, 'flatModifier', 'speed', 'swim', 5),
   },
   'Jade Warlord': {
      transform: (ae) => ae.system.rulesElement.splice(3, 0, {
         operation: 'flatModifier',
         selector: 'rating',
         key: 'melee',
         value: 1,
         uuid: uuid('jade-warlord-melee'),
      }),
   },
   'Telepathic Bond': {
      // The rules elements were copies of Stoke Rage's damage bonus; the bond grants no damage.
      remove: () => true,
      transform: (ae) => {
         ae.system.duration = {
            type: 'custom',
            remaining: 1,
            initiative: 1,
            custom: 'Hours',
         };
      },
   },
   'Fox Fire': {
      // Drops a stale legacy 'conditionalDiceModifier' duplicate of the valid conditionalCheckModifier.
      remove: (re) => re.operation === 'conditionalDiceModifier',
   },
   'Sage of Red Faith': {
      appendAfter: [
         'you must use an <strong>Action</strong> to direct it.',
         ' You may unleash your blood shadow, in which case it no longer requires an <strong>Action</strong> for it to act and it acts on its own accord. This usually means attacking whatever creature is nearest or most vulnerable — including you.',
      ],
   },
};
for (const ae of effects) {
   const fix = EFFECT_FIXES[ae.name];
   if (!fix) {
      continue;
   }
   const apply = (html) => {
      let t = html;
      for (const [from, to] of fix.replace ?? []) {
         t = t.split(from).join(to);
      }
      return t;
   };
   const before = JSON.stringify(ae);
   ae.description = apply(ae.description);
   if (fix.removeSentence) {
      // Drops the paragraph or sentence that starts with the given text (ongoing damage no longer in the rules).
      ae.description = ae.description.replace(/You take 1 <strong>Damage<\/strong> that ignores Armor[^<]*?\.\s*|You take 1 Damage that ignores Armor[^<]*?\.\s*/g, '');
   }
   if (fix.appendAfter) {
      const [anchor, text] = fix.appendAfter;
      if (!ae.description.includes(anchor)) {
         L(`WARN appendAfter anchor missing in ${ae.name}`);
      }
      ae.description = ae.description.replace(anchor, anchor + text);
   }
   fix.transform?.(ae);
   ae.system.rulesElement = ae.system.rulesElement
      .filter((re) => !fix.remove?.(re))
      .map((re) => (re.message ? {
         ...re,
         message: apply(re.message),
      } : re));
   if (before === JSON.stringify(ae)) {
      L(`WARN effect fix had no effect: ${ae.name}`);
   }
   else {
      L(`EFFECT-SYNCED ${ae.name}`);
   }
}
for (const d of out.spells) {
   if (d.name === 'Call Tornado') {
      const dmg = d.system.aspect.find((a) => a.label === 'damage');
      dmg.option = [];
      L('ASPECTS Call Tornado: damage no longer ignores Armor (rules text)');
   }
}

// ---------- item -> effect links ----------
const allItems = Object.values(out).flat().filter((d) => d._key.startsWith('!items!'));
const itemsByKey = new Map(allItems.map((d) => [key(d.name.replace(/\s*\((Choose|Rank I|\d+\/\d+|\d+)\)\s*$/i, '')), d]));
const linksFor = new Map();
for (const ae of effects) {
   const base = ae.name.replace(/\s*\([^)]*\)\s*$/, '');
   const ownerName = EFFECT_OWNER[base] ?? base;
   const owner = itemsByKey.get(key(ownerName));
   if (!owner) {
      L(`WARN no owning item for effect ${ae.name}`);
      continue;
   }
   if (!linksFor.has(owner)) {
      linksFor.set(owner, []);
   }
   linksFor.get(owner).push(ae);
}
for (const [item, list] of linksFor) {
   list.sort((a, b) => a.name.localeCompare(b.name));
   const links = list.map((ae) => `@UUID[Compendium.${MODULE}.effects.ActiveEffect.${ae._id}]{${ae.name}}`).join(', ');
   item.system.description += `<p><strong>${list.length > 1 ? 'Effects' : 'Effect'}:</strong> ${links}</p>`;
}
L(`LINKED ${linksFor.size} items to ${effects.length} effects`);

// ---------- rules journal links in item descriptions ----------
const ATTACK_TRAITS_PAGE = `Compendium.${MODULE}.rules.JournalEntry.mczts3I29Q5vaopp.JournalEntryPage.4i499LbqwSRtkdMc`;
for (const list of [...Object.values(out), effects]) {
   for (let i = 0; i < list.length; i++) {
      const before = JSON.stringify(list[i]);
      const after = before
         .split('Compendium.world.rules.KIi4xeIcGhj7JVda.JournalEntryPage.4i499LbqwSRtkdMc')
         .join(ATTACK_TRAITS_PAGE);
      if (before !== after) {
         Object.assign(list[i], JSON.parse(after));
         L(`LINK-FIXED ${list[i].name}`);
      }
      if (/Compendium.world./.test(after)) {
         L(`WARN world link remains in ${list[i].name}`);
      }
   }
}

fs.writeFileSync(path.join(STAGE, 'stage2.json'), JSON.stringify({
   out,
   effects,
   effectFolders: [...effectFolders.values()],
   packFolders,
}, null, 1));
fs.writeFileSync(path.join(STAGE, 'stage2-log.txt'), log.join('\n'));
console.log(log.filter((l) => !l.startsWith('EFFECT ')).join('\n'));
