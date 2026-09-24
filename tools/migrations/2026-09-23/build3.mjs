// Stage 3: new content (Deathsinger, Zephyr Style), Rules journal rebuild, summon fix; writes src-new/<pack>/*.json.
import fs from 'node:fs';
import path from 'node:path';
import { parseEntries, mdToHtml, key, norm } from '../../rules/lib.mjs';
import { STAGE, readRules } from './stage.mjs';
import { makeId, uuid } from './ids.mjs';

const MODULE = 'titan-vttrpg-compendium';
const md = readRules();
const mdLines = md.split(/\r?\n/);
const entries = parseEntries(md);
const st = JSON.parse(fs.readFileSync(path.join(STAGE, 'stage2.json'), 'utf8'));
const { out, effects, effectFolders, packFolders } = st;
const log = [];
const L = (...a) => log.push(a.join(' '));
const STATS = {
   systemId: 'titan',
   systemVersion: '1.0.0',
   coreVersion: '14.360',
   createdTime: Date.UTC(2026, 8, 23),
   modifiedTime: Date.UTC(2026, 8, 23),
   lastModifiedBy: null,
};
const escHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hdr = (e, label) => e.header.find((h) => h.label.toLowerCase() === label.toLowerCase())?.value;
const splitList = (v) => (v ? v.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean) : []);
const entry = (root, title) => {
   const e = entries.find((x) => x.path[0] === root && x.title === title);
   if (!e) {
      throw new Error(`no rules entry ${root} > ${title}`);
   }
   return e;
};

// ---------- summon fix ----------
for (const a of out.summons) {
   if (a.name === 'Astral Assassin') {
      a.items[0].system.attack[0].trait = ['piercing', 'penetrating', 'magical'].map((name) => ({
         name,
         value: true,
      }));
      L('ATTACK-TRAITS Astral Assassin: [] -> [piercing,penetrating,magical] (rules stat line)');
   }
}

// ---------- item checks that contradicted their rules text ----------
const CHECK_FIXES = {
   'Astral Banishment': (checks) => {
      checks[0].resolveCost = 1;
   },
   'Rebuke of the Arbiter': (checks) => {
      checks[0].resolveCost = 1;
   },
   "Stormcaller's Breath": (checks) => {
      checks[0].resistanceCheck = 'resilience';
      checks[0].resolveCost = 1;
   },
   'The Dragon Roars': (checks) => {
      checks[0].difficulty = 6;
      checks[0].resolveCost = 1;
      checks[0].isDamage = true;
   },
   // The current rules text has no check or damage (Disintegrate removes objects).
   'The Dragon Destroys': (checks) => {
      checks.splice(0, checks.length);
   },
};
// Checks the rules text specifies but the items lacked.
const CHECK_ADDS = {
   'Indestructible Spirit': () => check('Check', 'soul', 'metaphysics', 6, 1, {
      seed: 'indestructible-spirit',
   }),
   'Blood Wound': () => check('Check', 'soul', 'metaphysics', 4, 1, {
      seed: 'blood-wound',
      resolveCost: 1,
      isDamage: true,
   }),
};
for (const d of [...out.abilities, ...out['sacred-arts']]) {
   if (CHECK_ADDS[d.name] && !d.system.check.length) {
      d.system.check.push(CHECK_ADDS[d.name]());
      L(`CHECK-ADDED ${d.name}`);
   }
}
for (const d of out['sacred-arts']) {
   if (CHECK_FIXES[d.name]) {
      const before = JSON.stringify(d.system.check);
      CHECK_FIXES[d.name](d.system.check);
      L(`CHECK-FIXED ${d.name}: ${before} -> ${JSON.stringify(d.system.check.map((c) => `${c.difficulty}:${c.complexity} res=${c.resistanceCheck} cost=${c.resolveCost}`))}`);
   }
}

// ---------- new content ----------
function itemFolder(pack, name, parent, sort = 0) {
   const id = makeId(`${pack}-folder:${parent ?? ''}/${name}`);
   const f = {
      _id: id,
      _key: `!folders!${id}`,
      name,
      type: 'Item',
      folder: parent,
      sorting: 'a',
      sort,
      color: null,
      description: '',
      flags: {},
      _stats: STATS,
   };
   (packFolders[pack] ??= []).push(f);
   return id;
}
function check(label, attribute, skill, difficulty, complexity, opts = {}) {
   return {
      label,
      attribute,
      skill,
      difficulty,
      complexity,
      resolveCost: opts.resolveCost ?? 0,
      isDamage: opts.isDamage ?? false,
      isHealing: opts.isHealing ?? false,
      initialValue: 1,
      scaling: true,
      resistanceCheck: opts.resistanceCheck ?? 'none',
      opposedCheck: {
         enabled: false,
         attribute: 'body',
         skill: 'athletics',
      },
      uuid: uuid(`check:${label}:${opts.seed}`),
   };
}
const DESC_HEADER = ['Requirements', 'Cost', 'Range', 'Area'];
function newAbility(pack, e, { folder, sort, img, rarity, action = false, reaction = false, passive = false, checks = [] }) {
   const id = makeId(`${pack}-item:${e.title}`);
   const header = e.header.filter((h) => DESC_HEADER.includes(h.label))
      .map((h) => `<p><strong>${escHtml(h.label)}:</strong> ${escHtml(h.value)}</p>`).join('');
   const d = {
      _id: id,
      _key: `!items!${id}`,
      name: e.title,
      type: 'ability',
      img,
      system: {
         description: header + mdToHtml(e.body),
         check: checks.map((c) => ({
            ...c,
            uuid: uuid(`check:${e.title}:${c.label}`),
         })),
         customTrait: splitList(hdr(e, 'Traits')).map((t) => ({
            name: t,
            description: '',
            uuid: uuid(`trait:${t}`),
         })),
         xpCost: 2,
         rarity: (hdr(e, 'Rarity') ?? rarity).toLowerCase(),
         rulesElement: [],
         action,
         reaction,
         passive,
      },
      effects: [],
      folder,
      sort,
      ownership: {
         default: 0,
      },
      flags: {},
      _stats: STATS,
   };
   (out[pack] ??= []).push(d);
   L(`NEW-ITEM [${pack}] ${d.name}`);
   return d;
}
function ensureEffectFolder(names) {
   let parent = null;
   for (let i = 0; i < names.length; i++) {
      const p = names.slice(0, i + 1).join('/');
      let f = effectFolders.find((x) => x._pathKey === p) ?? effectFolders.find((x) => x._id === makeId(`effects-folder:${p}`));
      if (!f) {
         const id = makeId(`effects-folder:${p}`);
         f = {
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
         };
         effectFolders.push(f);
      }
      parent = f._id;
   }
   return parent;
}
const P = (t) => `<p>${t}</p>`;
function newEffect(item, name, folderNames, { duration, description, rules = [] }) {
   const id = makeId(`effect:${name}`);
   const ae = {
      _id: id,
      _key: `!effects!${id}`,
      name,
      type: 'effect',
      img: item.img,
      description,
      disabled: false,
      transfer: false,
      origin: null,
      statuses: [],
      changes: [],
      folder: ensureEffectFolder(folderNames),
      sort: 0,
      flags: {},
      system: {
         duration: {
            initiative: 1,
            custom: '',
            remaining: 1,
            ...duration,
         },
         check: [],
         customTrait: structuredClone(item.system.customTrait),
         rulesElement: rules.map((r, i) => ({
            ...r,
            uuid: uuid(`re:${name}:${i}`),
         })),
      },
      _stats: STATS,
   };
   effects.push(ae);
   L(`NEW-EFFECT ${name}`);
   return ae;
}
function linkEffects(item, list) {
   list.sort((a, b) => a.name.localeCompare(b.name));
   const links = list.map((ae) => `@UUID[Compendium.${MODULE}.effects.ActiveEffect.${ae._id}]{${ae.name}}`).join(', ');
   item.system.description += `<p><strong>${list.length > 1 ? 'Effects' : 'Effect'}:</strong> ${links}</p>`;
}
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
const rollMsg = (label, checkType, selector, k, html) => ({
   operation: 'rollMessage',
   checkType,
   selector,
   key: k,
   message: `<p><strong>${label}:</strong> ${html}</p>`,
});
const SUSTAIN = 'You may spend <strong>1 Resolve</strong> at the start of your turn to sustain this effect.';
const SPEEDS = ['stride', 'fly', 'swim', 'burrow', 'climb'];

// Path of the Deathsinger.
{
   const pack = 'sacred-arts';
   const img = 'icons/magic/death/skull-horned-white-purple.webp';
   const root = itemFolder(pack, 'Deathsinger', null);
   const abil = itemFolder(pack, 'Abilities', root);
   const apex = itemFolder(pack, 'Apex', root);
   const E = (t) => entry('The Sacred Arts', t);
   const soulMeta = (label, diff, opts = {}) => check(label, 'soul', 'metaphysics', diff, 1, opts);
   const efx = ['Sacred Arts', 'Deathsinger', 'Abilities'];
   newAbility(pack, E('Path of the Deathsinger'), {
      folder: root,
      sort: 0,
      img,
      rarity: 'rare',
      passive: true,
   });
   let sort = 100000;
   const next = () => (sort += 100000);
   const call = newAbility(pack, E("Deathsinger's Call"), {
      folder: abil,
      sort: next(),
      img,
      rarity: 'rare',
      action: true,
   });
   linkEffects(call, [newEffect(call, "Deathsinger's Call", efx, {
      duration: {
         type: 'turnStart',
      },
      description: P('Until the start of your next turn, you may make attacks and take <strong>Actions</strong> as though you occupied the chosen corpse\'s space, measuring <strong>Range</strong>, <strong>Area</strong>, and line of sight from it. You are still targeted, attacked, and affected where you actually are.') + P(SUSTAIN),
      rules: [turnMsg("Deathsinger's Call", SUSTAIN)],
   })]);
   const chorus = newAbility(pack, E("Deathsinger's Chorus"), {
      folder: abil,
      sort: next(),
      img,
      rarity: 'rare',
      action: true,
   });
   linkEffects(chorus, [newEffect(chorus, "Deathsinger's Chorus", efx, {
      duration: {
         type: 'turnStart',
      },
      description: P('Until the start of your next turn, you gain <strong>+1 bonus dice</strong> per chosen corpse (up to your <strong>Training</strong> in <strong>Metaphysics</strong>) to any <strong>Check</strong> you make with the <strong>Deathsinger</strong> trait.'),
      rules: [rollMsg("Deathsinger's Chorus", 'any', 'customTrait', 'Deathsinger', 'Add <strong>+1 bonus dice</strong> per corpse chosen for this ability.')],
   })]);
   const hand = newAbility(pack, E("Deathsinger's Guiding Hand"), {
      folder: abil,
      sort: next(),
      img,
      rarity: 'rare',
      action: true,
      checks: [soulMeta('Guiding Hand', 4, {
         resistanceCheck: 'resilience',
      })],
   });
   linkEffects(hand, [
      newEffect(hand, "Deathsinger's Guiding Hand (Long Arms)", efx, {
         duration: {
            type: 'initiative',
         },
         description: P('Your <strong>Melee</strong> and the <strong>Range</strong> of your <strong>Melee</strong> attacks increase by <strong>+1</strong>, and your <strong>Defense</strong> decreases by <strong>-1</strong>.'),
         rules: [
            flat('rating', 'melee', 1),
            flat('rating', 'defense', -1),
            rollMsg('Long Arms', 'attack', 'attackType', 'melee', 'The <strong>Range</strong> of your <strong>Melee</strong> attacks increases by <strong>+1</strong>.'),
         ],
      }),
      newEffect(hand, "Deathsinger's Guiding Hand (Armored Carapace)", efx, {
         duration: {
            type: 'initiative',
         },
         description: P('Your <strong>Armor</strong> increases by <strong>+2</strong>, and your speed is reduced by half, rounded up.'),
         rules: [flat('mod', 'armor', 2), ...SPEEDS.map((s) => ({
            operation: 'mulBase',
            selector: 'speed',
            key: s,
            value: 0.5,
         }))],
      }),
      newEffect(hand, "Deathsinger's Guiding Hand (Environmental Adaptation)", efx, {
         duration: {
            type: 'initiative',
         },
         description: P('You gain <strong>+5</strong> to a <strong>Speed</strong> of the ability user\'s choice, and no longer need to breathe.'),
         rules: [turnMsg('Environmental Adaptation', 'You gain <strong>+5</strong> to a chosen <strong>Speed</strong>, and no longer need to breathe.')],
      }),
   ]);
   const canvas = newAbility(pack, E("Deathsinger's Fresh Canvas"), {
      folder: abil,
      sort: next(),
      img,
      rarity: 'rare',
      action: true,
      checks: [soulMeta('Fresh Canvas', 5, {
         resolveCost: 1,
         resistanceCheck: 'resilience',
      })],
   });
   linkEffects(canvas, [newEffect(canvas, "Deathsinger's Fresh Canvas", efx, {
      duration: {
         type: 'custom',
         custom: 'Until Long Rest',
      },
      description: P('Your <strong>Body</strong> is reduced by <strong>1 + ES</strong>, where <strong>ES</strong> equals the difference in successes, until you complete a <strong>Long Rest</strong>. If your <strong>Body</strong> is reduced to <strong>0</strong>, you come apart and die.') + P('This effect applies <strong>-1 Body</strong>; lower the value to match the difference in successes.'),
      rules: [flat('attribute', 'body', -1)],
   })]);
   const lullaby = newAbility(pack, E("Deathsinger's Lullaby"), {
      folder: abil,
      sort: next(),
      img,
      rarity: 'rare',
      action: true,
      checks: [soulMeta('Lullaby', 4, {
         resolveCost: 2,
         resistanceCheck: 'willpower',
      })],
   });
   linkEffects(lullaby, [newEffect(lullaby, "Deathsinger's Lullaby", efx, {
      duration: {
         type: 'initiative',
      },
      description: P('You are beguiled by the song of the Dead Mother. You must use all available <strong>Actions</strong> and <strong>Moves</strong> to be as near to the singer as possible, then stop and listen.') + P('This effect ends if you are harmed or become unable to hear the singer, or if the singer speaks for any purpose other than to continue the song.'),
      rules: [turnMsg("Deathsinger's Lullaby", 'You must use all available <strong>Actions</strong> and <strong>Moves</strong> to be as near to the singer as possible.')],
   })]);
   const mercy = newAbility(pack, E("Deathsinger's Mercy"), {
      folder: abil,
      sort: next(),
      img,
      rarity: 'rare',
      action: true,
      checks: [soulMeta('Mercy', 4, {
         isHealing: true,
      })],
   });
   linkEffects(mercy, [newEffect(mercy, "Deathsinger's Mercy", efx, {
      duration: {
         type: 'custom',
         custom: 'Until restored',
      },
      description: P('Your <strong>Body</strong> is reduced by <strong>-1</strong>. When you complete a <strong>Long Rest</strong>, you may restore any amount of <strong>Body</strong> lost this way at the cost of <strong>+1 Wounds</strong> per <strong>Body</strong> restored.'),
      rules: [flat('attribute', 'body', -1)],
   })]);
   const miasma = newAbility(pack, E("Deathsinger's Miasma"), {
      folder: abil,
      sort: next(),
      img,
      rarity: 'rare',
      action: true,
   });
   linkEffects(miasma, [newEffect(miasma, "Deathsinger's Miasma", efx, {
      duration: {
         type: 'turnStart',
      },
      description: P('Every space within <strong>5 spaces</strong> of you is <strong>Obscured (1)</strong>. Any creature other than you that starts its turn in the area becomes <strong>Contaminated</strong> until the start of your next turn.') + P(`${SUSTAIN} Each time you sustain it, the radius increases by <strong>+1 space</strong>, to a maximum of <strong>5 + your Soul</strong>.`),
      rules: [turnMsg("Deathsinger's Miasma", `${SUSTAIN} Each time you sustain it, the radius increases by <strong>+1 space</strong>.`)],
   })]);
   const rebirth = newAbility(pack, E("Deathsinger's Rebirth"), {
      folder: abil,
      sort: next(),
      img,
      rarity: 'rare',
      reaction: true,
      checks: [],
   });
   linkEffects(rebirth, [newEffect(rebirth, "Deathsinger's Rebirth", efx, {
      duration: {
         type: 'custom',
         custom: 'Until Long Rest',
      },
      description: P('You were remade instead of dying. One chosen <strong>Attribute</strong> is reduced by <strong>-1</strong> and a second is increased by <strong>+1</strong> until you complete a <strong>Long Rest</strong>.') + P('Add the two attribute modifiers chosen by the ability user to this effect.'),
   })]);
   const refrain = newAbility(pack, E("Deathsinger's Refrain"), {
      folder: abil,
      sort: next(),
      img,
      rarity: 'rare',
      action: true,
      checks: [soulMeta('Refrain', 4, {
         resolveCost: 1,
         isDamage: true,
         resistanceCheck: 'resilience',
      })],
   });
   linkEffects(refrain, [newEffect(refrain, "Deathsinger's Refrain", efx, {
      duration: {
         type: 'initiative',
      },
      description: P('You are <strong>Contaminated</strong> by an infectious disease. At the start of your turn, the singer makes a <strong>4:1 Soul (Metaphysics)</strong> check resisted by your <strong>Resilience</strong>. If it succeeds, you take <strong>Damage</strong> equal to the difference in successes, ignoring <strong>Armor</strong>; otherwise, the effect ends.') + P('While the singer sustains the effect, creatures adjacent to you also become <strong>Contaminated</strong> and are treated as additional targets.'),
      rules: [turnMsg("Deathsinger's Refrain", 'The singer makes a <strong>4:1 Soul (Metaphysics)</strong> check resisted by your <strong>Resilience</strong>. On a success you take <strong>Damage</strong> equal to the difference in successes, ignoring <strong>Armor</strong>; otherwise this effect ends.')],
   })]);
   const elder = newAbility(pack, E('Elder Sibling'), {
      folder: apex,
      sort: 100000,
      img,
      rarity: 'rare',
      action: true,
   });
   const elderRules = (a, b) => [
      flat('attribute', a, 2),
      flat('attribute', b, 2),
      ...SPEEDS.map((s) => flat('speed', s, 5)),
      rollMsg('Elder Sibling', 'attack', 'attackType', 'melee', 'Your <strong>Unarmed</strong> attacks are not <strong>Ineffective</strong>, and the <strong>Range</strong> of your <strong>Melee</strong> attacks increases by <strong>+1</strong>.'),
      turnMsg('Elder Sibling', 'Once per turn, when a creature dies within <strong>10 spaces</strong> of you, you may integrate its useful parts as a <strong>Free Action</strong> to reduce your <strong>Wounds</strong> by <strong>1</strong>, or to restore <strong>Stamina</strong> equal to your <strong>Body</strong>.'),
   ];
   const elderDesc = (a, b) => P('You have completed your remaking and taken on a dreadful new form.') +
      `<ul><li><p>Your <strong>${a}</strong> and <strong>${b}</strong> increase by <strong>+2</strong>.</p></li>` +
      '<li><p>Your <strong>Unarmed</strong> attacks are no longer considered <strong>Ineffective</strong>, the <strong>Range</strong> of your <strong>Melee</strong> attacks increases by <strong>+1</strong>, and all your <strong>Speeds</strong> increase by <strong>+5</strong>.</p></li>' +
      '<li><p>You cannot become <strong>Contaminated</strong>, you do not need to breathe, and you are immune to disease and poison.</p></li>' +
      '<li><p>Once per turn, when a creature dies within <strong>10 spaces</strong> of you, you may integrate its useful parts as a <strong>Free Action</strong> to reduce your <strong>Wounds</strong> by <strong>1</strong>, or to restore <strong>Stamina</strong> equal to your <strong>Body</strong>.</p></li></ul>' +
      P('This effect lasts until the end of combat, you become <strong>Incapacitated</strong>, or you are <strong>Dying</strong>. After you use this ability, you cannot use any ability with the <strong>Apex</strong> trait until you complete a <strong>Long Rest</strong>.');
   const apexFx = ['Sacred Arts', 'Deathsinger', 'Apex'];
   linkEffects(elder, [
      ['Body', 'Mind'],
      ['Body', 'Soul'],
      ['Mind', 'Soul'],
   ].map(([a, b]) => newEffect(elder, `Elder Sibling (${a} & ${b})`, apexFx, {
      duration: {
         type: 'permanent',
         remaining: 2,
      },
      description: elderDesc(a, b),
      rules: elderRules(a.toLowerCase(), b.toLowerCase()),
   })));
}

// New spell: Cleansing Light (Light tradition; the rules header's "Traits: Water" is reported as an error).
{
   const e = entry('The Arcane Arts', 'Cleansing Light');
   const lightFolder = packFolders.spells.find((f) => f.name === 'Light')._id;
   const id = makeId('spells-item:Cleansing Light');
   out.spells.push({
      _id: id,
      _key: `!items!${id}`,
      name: 'Cleansing Light',
      type: 'spell',
      img: 'modules/titan-vttrpg-compendium/icons/traditions/Light_Tradition_Icon.webp',
      system: {
         description: mdToHtml(e.body),
         check: [],
         customTrait: [],
         rarity: 'uncommon',
         xpCost: 0,
         tradition: 'Light',
         castingCheck: {
            attribute: 'mind',
            skill: 'arcana',
            difficulty: 4,
            complexity: 1,
            autoCalculateDC: false,
         },
         quantity: 1,
         aspect: [
            {
               label: 'range',
               initialValue: 'touch',
               enabled: true,
            },
            {
               label: 'extraTargets',
               scaling: true,
               initialValue: 0,
               cost: 1,
               scalingCost: 1,
               enabled: true,
            },
         ],
         customAspect: [],
      },
      effects: [],
      folder: lightFolder,
      sort: 400000,
      ownership: {
         default: 0,
      },
      flags: {},
      _stats: STATS,
   });
   L('NEW-ITEM [spells] Cleansing Light');
   L('HEADER-ERROR Cleansing Light: listed under the Light tradition but its Traits line reads "Water"; filed as Light');
}

// Combat Styles: Zephyr Style.
{
   const pack = 'combat-styles';
   const img = 'icons/magic/air/air-wave-gust-blue.webp';
   const root = itemFolder(pack, 'Zephyr Style', null);
   const abil = itemFolder(pack, 'Abilities', root);
   const myth = itemFolder(pack, 'Mythic Technique', root);
   const E = (t) => entry('Combat Styles', t);
   const efx = ['Combat Styles', 'Zephyr Style'];
   const style = newAbility(pack, E('Zephyr Style'), {
      folder: root,
      sort: 0,
      img,
      rarity: 'uncommon',
      action: true,
   });
   linkEffects(style, [newEffect(style, 'Zephyr Style', efx, {
      duration: {
         type: 'permanent',
      },
      description: P('You are in <strong><em>Zephyr Style</em></strong>.') +
         '<ul><li><p>The height and distance of your <strong>Jump</strong> is doubled, and you ignore <strong>Difficult Terrain</strong>.</p></li>' +
         '<li><p>Your maximum <strong>Focus</strong> is <strong>3</strong>. Once per turn, you may use an <strong>Action</strong> to gain <strong>+1 Focus</strong>.</p></li>' +
         '<li><p><strong>Channel the Wind:</strong> at the end of your turn, gain <strong>+1 Focus</strong> if you used the <strong>Dodge</strong> action, and <strong>+1 Focus</strong> if you attacked with a <strong>Melee</strong> or <strong>Ranged Weapon</strong> and ended your turn at least <strong>2 Spaces</strong> from where it began.</p></li>' +
         '<li><p>When you make an <strong>Attack Check</strong> with a <strong>Melee</strong> or <strong>Ranged</strong> weapon, you may spend up to <strong>3 Focus</strong>, before or after rolling, to gain <strong>+1 bonus Expertise</strong> per <strong>Focus</strong> spent.</p></li></ul>' +
         P('<strong><em>Zephyr Style</em></strong> ends if you did not spend or gain any <strong>Focus</strong> during your turn, if you have <strong>0 Focus</strong> at the end of your turn, or if you enter another <strong>Stance</strong>.'),
      rules: [
         rollMsg('Zephyr Style', 'attack', 'any', '', 'You may spend up to <strong>3 Focus</strong>, before or after rolling, to gain <strong>+1 bonus Expertise</strong> per <strong>Focus</strong> spent.'),
         turnMsg('Zephyr Style', '<strong>Channel the Wind</strong> at the end of your turn. The style ends if you did not spend or gain <strong>Focus</strong> this turn, or have <strong>0 Focus</strong> at the end of your turn.'),
      ],
   })]);
   const flags = {
      'Borrow the Winds': {
         passive: true,
      },
      'Buffeting Strike': {
         reaction: true,
      },
      'Curving Shot': {
         passive: true,
      },
      'Empower the Winds': {
         passive: true,
      },
      'Flinging Updraft': {
         action: true,
         reaction: true,
      },
      'Flurry Strike': {
         action: true,
      },
      'Gust Strike': {
         action: true,
      },
      Slipstream: {
         reaction: true,
      },
      Tailwinds: {
         passive: true,
      },
      'Trade Winds': {
         action: true,
      },
   };
   let sort = 100000;
   for (const [name, f] of Object.entries(flags)) {
      newAbility(pack, E(name), {
         folder: abil,
         sort: (sort += 100000),
         img,
         rarity: 'uncommon',
         ...f,
      });
   }
   const whirl = newAbility(pack, E('Living Whirlwind'), {
      folder: myth,
      sort: 100000,
      img,
      rarity: 'rare',
      action: true,
   });
   linkEffects(whirl, [newEffect(whirl, 'Living Whirlwind', [...efx, 'Mythic Technique'], {
      duration: {
         type: 'turnStart',
      },
      description: P('You ended <strong><em>Zephyr Style</em></strong> after performing <strong><em>Living Whirlwind</em></strong>. All attacks against you have <strong>Disadvantage</strong> until the start of your next turn, and you may not enter <strong><em>Zephyr Style</em></strong> again until the start of your next turn.'),
      rules: [],
   })]);
}

// ---------- Rules journal ----------
const headingRe = /^(#{1,6})\s+(.*)$/;
function sectionLines(title, level, afterLine = 0) {
   const start = mdLines.findIndex((l, i) => i >= afterLine && headingRe.test(l) && l.match(headingRe)[1].length === level && norm(l.match(headingRe)[2]) === title);
   if (start < 0) {
      throw new Error(`no section ${title}`);
   }
   let end = start + 1;
   while (end < mdLines.length) {
      const m = mdLines[end].match(headingRe);
      if (m && m[1].length <= level && norm(m[2]) && norm(m[2]) !== '---') {
         break;
      }
      end++;
   }
   return {
      start,
      lines: mdLines.slice(start + 1, end),
   };
}
// Renders rules markdown with headings shifted so the section's children become h2.
function renderRules(lines, rootLevel) {
   const outHtml = [];
   let buf = [];
   // Renders the buffer, wrapping runs of ">"-quoted lines (the rules' examples) in <blockquote>.
   const flush = () => {
      let run = [];
      let quoted = false;
      const emit = () => {
         if (run.some((l) => l.trim())) {
            const html = mdToHtml(run);
            outHtml.push(quoted ? `<blockquote>${html}</blockquote>` : html);
         }
         run = [];
      };
      for (const l of buf) {
         const isQuote = /^\s*>/.test(l);
         if (l.trim() && isQuote !== quoted) {
            emit();
            quoted = isQuote;
         }
         run.push(l);
      }
      emit();
      buf = [];
   };
   for (const l of lines) {
      const m = l.match(headingRe);
      if (m && norm(m[2]) && norm(m[2]) !== '---') {
         flush();
         const h = Math.min(Math.max(m[1].length - rootLevel + 1, 2), 4);
         outHtml.push(`<h${h}>${escHtml(norm(m[2]))}</h${h}>`);
      }
      else if (/^\s*(#+\s*)?-{3,}\s*$/.test(l)) {
         continue;
      }
      else {
         buf.push(l);
      }
   }
   flush();
   return outHtml.join('');
}
// Drops sub-sections whose heading matches the predicate (e.g. item entries).
function without(lines, pred) {
   const res = [];
   let skipLevel = 0;
   for (const l of lines) {
      const m = l.match(headingRe);
      const title = m ? norm(m[2]) : '';
      if (m && title && title !== '---') {
         if (skipLevel && m[1].length > skipLevel) {
            continue;
         }
         skipLevel = 0;
         if (pred(m[1].length, title)) {
            skipLevel = m[1].length;
            continue;
         }
      }
      if (!skipLevel) {
         res.push(l);
      }
   }
   return res;
}
const journal = out.rules?.[0] ?? JSON.parse(fs.readFileSync(path.join(STAGE, 'src-orig/rules/Rules_Reference_mczts3I29Q5vaopp.json'), 'utf8'));
const oldPages = new Map(journal.pages.map((p) => [p.name, p]));
const pageDefs = [];
const addPage = (name, html, oldName = name) => pageDefs.push({
   name,
   html,
   oldName,
});
{
   const cc = sectionLines('Character Creation and Progression', 1);
   addPage('Character Creation and Progression', renderRules(cc.lines, 1));
   for (const t of ['Attributes', 'Skills', 'Resources', 'Resistances', 'Ratings']) {
      addPage(t, renderRules(sectionLines(t, 2).lines, 2));
   }
   for (const t of ['Checks', 'Actions', 'Combat', 'Death and Dying', 'Counteracting Spells and Abilities', 'Resting',
      'Conditions', 'Environmental Traits', 'Creature Roles', 'Jumping', 'Falling', 'Suffocating']) {
      addPage(t, renderRules(sectionLines(t, 2).lines, 2));
   }
   const itemTitles = new Set(Object.values(out).flat().map((d) => key(d.name.replace(/\s*\((Choose|Rank I|\d+\/\d+|\d+)\)\s*$/i, ''))));
   const equipStart = sectionLines('Equipment', 1).start;
   addPage('Attack Traits', renderRules(sectionLines('Attack Traits', 3, equipStart).lines, 3));
   addPage('Defensive Traits', renderRules(sectionLines('Defensive Traits', 3, equipStart).lines, 3), 'Armor Traits');
   // Equipment intro text: the section minus trait lists and item entries.
   const equip = without(sectionLines('Equipment', 1).lines, (lvl, t) => (lvl === 3 && ['Attack Traits', 'Defensive Traits'].includes(t)) || (lvl >= 4 && itemTitles.has(key(t))) || lvl === 5);
   const urderic = without(sectionLines('Urderic Equipment', 1).lines, (lvl, t) => lvl >= 4);
   addPage('Equipment', renderRules(equip, 1) + '<h2>Urderic Equipment</h2>' + renderRules(urderic, 1).replace(/<h2>/g, '<h3>').replace(/<\/h2>/g, '</h3>'));
   const arcane = without(sectionLines('The Arcane Arts', 1).lines, (lvl) => lvl >= 4);
   addPage('The Arcane Arts', renderRules(arcane, 1));
   const sacred = without(sectionLines('The Sacred Arts', 1).lines, (lvl) => lvl >= 3);
   addPage('The Sacred Arts', renderRules(sacred, 1), 'The Sacred Art');
}
// Restores the journal's cross-page links.
const LINKS = {
   'Death and Dying': [['the <strong>Stunned</strong> condition', 'the @UUID[.K9oX3Z9KHKswUMyf#stunned]{Stunned} condition']],
};
const pages = [];
let sort = 0;
for (const def of pageDefs) {
   const old = oldPages.get(def.oldName);
   let html = def.html;
   for (const [from, to] of LINKS[def.name] ?? []) {
      if (!html.includes(from)) {
         L(`WARN journal link anchor not found on ${def.name}: ${from}`);
      }
      html = html.replace(from, to);
   }
   const id = old?._id ?? makeId(`rules-page:${def.name}`);
   pages.push({
      ...(old ?? {}),
      _id: id,
      _key: `!journal.pages!${journal._id}.${id}`,
      name: def.name,
      type: 'text',
      title: {
         show: true,
         level: 1,
      },
      text: {
         format: 1,
         content: html,
      },
      sort: (sort += 100000),
      ownership: {
         default: -1,
      },
      flags: {},
   });
   L(`${old ? 'PAGE-REBUILT' : 'PAGE-NEW'} ${def.name}${def.oldName !== def.name ? ` (was ${def.oldName})` : ''}`);
}
// Inspiration is referenced by the rules ("Using an Inspiration") but not defined in the rules document; kept as-is.
const insp = oldPages.get('Inspiration');
pages.push({
   ...insp,
   sort: (sort += 100000),
});
L('PAGE-KEPT Inspiration (not in the rules document; the rules reference it)');
L('PAGE-DELETED Spending Resolve (empty; the rules cover it under Combat)');
journal.pages = pages;
journal._stats = {
   ...journal._stats,
   coreVersion: STATS.coreVersion,
};
out.rules = [journal];

// ---------- write ----------
const dest = path.join(STAGE, 'src-new');
// The tools never delete files; a stale src-new must be moved to the recycle bin by hand first.
if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
   throw new Error(`${dest} is not empty; move it to the recycle bin first.`);
}
const write = (pack, doc) => {
   const dir = path.join(dest, pack);
   fs.mkdirSync(dir, {
      recursive: true,
   });
   const safe = `${doc.name}`.replace(/[^A-Za-z0-9]+/g, '_');
   fs.writeFileSync(path.join(dir, `${safe}_${doc._id}.json`), `${JSON.stringify(doc, null, 2)}\n`);
};
const usedFolders = {};
for (const [pack, docs] of Object.entries(out)) {
   for (const d of docs) {
      write(pack, d);
      if (d.folder) {
         (usedFolders[pack] ??= new Set()).add(d.folder);
      }
   }
}
// Folders: keep only folders that contain documents (directly or via subfolders).
for (const [pack, folders] of Object.entries(packFolders)) {
   if (!out[pack]) {
      continue;
   }
   const used = usedFolders[pack] ?? new Set();
   let changed = true;
   while (changed) {
      changed = false;
      for (const f of folders) {
         if (used.has(f._id) && f.folder && !used.has(f.folder)) {
            used.add(f.folder);
            changed = true;
         }
      }
   }
   for (const f of folders) {
      if (used.has(f._id)) {
         write(pack, f);
      }
      else {
         L(`FOLDER-DELETED [${pack}] ${f.name} (empty)`);
      }
   }
}
for (const e of effects) {
   write('effects', e);
}
for (const f of effectFolders) {
   write('effects', f);
}
fs.writeFileSync(path.join(STAGE, 'stage3-log.txt'), log.join('\n'));
console.log(log.join('\n'));
