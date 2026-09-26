// Rebuilds the Rules journal pages from a TITAN Rules Compendium markdown export. Each page is one rules section
// with its item entries removed (the items live in the item packs), rendered to HTML with headings shifted so a
// section's children become h2. Existing page ids, ownership, and the cross-page links below are preserved.
import { mdToHtml, key, norm } from './lib.mjs';
import { makeId } from '../ids.mjs';

/** @type {RegExp} Matches a markdown heading line: `#`s, then text. */
const headingRe = /^(#{1,6})\s+(.*)$/;

/** @type {RegExp} Matches an empty heading (a lone `#` run) that the document export leaves between sections. */
const emptyHeadingRe = /^#+\s*$/;

/** @type {object} The fields Foundry adds to a text page; pages new to the journal start from these. */
const NEW_PAGE_DEFAULTS = {
   image: {},
   video: {
      controls: true,
      volume: 0.5,
   },
   src: null,
   system: {},
   category: null,
   _stats: {
      coreVersion: '14.364',
      systemId: 'titan',
      systemVersion: '1.0.0',
      createdTime: null,
      modifiedTime: null,
      lastModifiedBy: null,
      compendiumSource: null,
      duplicateSource: null,
      exportSource: null,
   },
};

/** @type {Record<string, string[][]>} Cross-page links restored after rendering: page name -> [text, replacement]. */
const LINKS = {
   'Death and Dying': [['the <strong>Stunned</strong> condition', 'the @UUID[.K9oX3Z9KHKswUMyf#stunned]{Stunned} condition']],
};

/**
 * Escapes HTML text.
 * @param {string} t - The text.
 * @returns {string} The escaped text.
 */
const escHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Builds the journal with every page regenerated from the rules markdown.
 * @param {string} md - The rules markdown.
 * @param {object} journal - The current journal document; its page ids, ownership, and stats carry over.
 * @param {string[]} docNames - Every item and actor name in the packs; item entries with these names are dropped
 * from the Equipment page.
 * @param {(page: string, html: string) => string} [patch] - Optional post-render fix for a page's HTML.
 * @returns {{journal: object, log: string[]}} The rebuilt journal and a line per page.
 */
export function buildJournal(md, journal, docNames, patch = (page, html) => html) {
   const mdLines = md.split(/\r?\n/).filter((l) => !emptyHeadingRe.test(l));
   const log = [];

   // Finds a section by heading level and title, returning its start index and the lines up to the next
   // heading of the same or a higher level.
   const sectionLines = (title, level, afterLine = 0) => {
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
   };

   // Renders rules markdown with headings shifted so the section's children become h2; runs of ">"-quoted lines
   // (the rules' examples) are wrapped in <blockquote>.
   const renderRules = (lines, rootLevel) => {
      const outHtml = [];
      let buf = [];
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
   };

   // Drops sub-sections whose heading matches the predicate (e.g. item entries).
   const without = (lines, pred) => {
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
   };

   const oldPages = new Map(journal.pages.map((p) => [p.name, p]));
   const pageDefs = [];
   const addPage = (name, html, oldName = name) => pageDefs.push({
      name,
      html,
      oldName,
   });
   const cc = sectionLines('Character Creation and Progression', 1);
   addPage('Character Creation and Progression', renderRules(cc.lines, 1));
   for (const t of ['Attributes', 'Skills', 'Resources', 'Resistances', 'Ratings']) {
      addPage(t, renderRules(sectionLines(t, 2).lines, 2));
   }
   for (const t of ['Checks', 'Actions', 'Combat', 'Death and Dying', 'Counteracting Spells and Abilities', 'Resting',
      'Conditions', 'Environmental Traits', 'Creature Roles', 'Jumping', 'Falling', 'Suffocating']) {
      addPage(t, renderRules(sectionLines(t, 2).lines, 2));
   }
   const itemTitles = new Set(docNames.map((n) => key(n.replace(/\s*\((Choose|Rank I|\d+\/\d+|\d+)\)\s*$/i, ''))));
   const equipStart = sectionLines('Equipment', 1).start;
   addPage('Attack Traits', renderRules(sectionLines('Attack Traits', 3, equipStart).lines, 3));
   addPage('Defensive Traits', renderRules(sectionLines('Defensive Traits', 3, equipStart).lines, 3), 'Armor Traits');
   // Equipment intro text: the section minus trait lists and item entries.
   const equip = without(sectionLines('Equipment', 1).lines, (lvl, t) => (lvl === 3 && ['Attack Traits', 'Defensive Traits'].includes(t)) || (lvl >= 4 && itemTitles.has(key(t))) || lvl === 5);
   const urderic = without(sectionLines('Urderic Equipment', 1).lines, (lvl) => lvl >= 4);
   addPage('Equipment', renderRules(equip, 1) + '<h2>Urderic Equipment</h2>' + renderRules(urderic, 1).replace(/<h2>/g, '<h3>').replace(/<\/h2>/g, '</h3>'));
   const arcane = without(sectionLines('The Arcane Arts', 1).lines, (lvl) => lvl >= 4);
   addPage('The Arcane Arts', renderRules(arcane, 1));
   const sacred = without(sectionLines('The Sacred Arts', 1).lines, (lvl) => lvl >= 3);
   addPage('The Sacred Arts', renderRules(sacred, 1), 'The Sacred Art');
   const martialTitle = ['Martial Styles', 'Combat Styles'].find((t) => mdLines.some((l) => headingRe.test(l) && l.match(headingRe)[1].length === 1 && norm(l.match(headingRe)[2]) === t));
   const martial = martialTitle ? without(sectionLines(martialTitle, 1).lines, (lvl) => lvl >= 2) : [];
   if (martial.some((l) => l.trim())) {
      addPage(martialTitle, renderRules(martial, 1));
   }

   const pages = [];
   let sort = 0;
   for (const def of pageDefs) {
      const old = oldPages.get(def.name) ?? oldPages.get(def.oldName);
      let html = patch(def.name, def.html);
      for (const [from, to] of LINKS[def.name] ?? []) {
         if (!html.includes(from)) {
            log.push(`WARN journal link anchor not found on ${def.name}: ${from}`);
         }
         html = html.replace(from, to);
      }
      const id = old?._id ?? makeId(`rules-page:${def.name}`);
      pages.push({
         ...(old ?? NEW_PAGE_DEFAULTS),
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
      log.push(`${old ? 'PAGE-REBUILT' : 'PAGE-NEW'} ${def.name}${old && old.name !== def.name ? ` (was ${old.name})` : ''}`);
   }
   // Inspiration is referenced by the rules ("Using an Inspiration") but not defined in the rules document.
   const insp = oldPages.get('Inspiration');
   if (insp) {
      pages.push({
         ...insp,
         sort: (sort += 100000),
      });
      log.push('PAGE-KEPT Inspiration (not in the rules document; the rules reference it)');
   }
   return {
      journal: {
         ...journal,
         pages,
      },
      log,
   };
}
