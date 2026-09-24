// Shared helpers for comparing the TITAN Rules Compendium markdown (a Google Docs export) against pack sources:
// markdown entry parsing, markdown -> HTML, text normalization, pack walking, and a word diff.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Normalizes markdown or HTML-entity text for comparison: strips heading anchors, markdown escapes and emphasis
 * markers, unifies quotes and dashes, decodes common entities, and collapses whitespace.
 * @param {string} t - The text to normalize.
 * @returns {string} The normalized text.
 */
export function norm(t) {
   return t
      .replace(/\{#[^}]*\}/g, '')
      .replace(/\\([+\-()*_#.!\[\]])/g, '$1')
      .replace(/[*_]/g, '')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[—–]/g, ' — ')
      .replace(/\u00a0/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
}
/**
 * Reduces a name to a lowercase alphanumeric match key.
 * @param {string} n - The name.
 * @returns {string} The match key.
 */
export const key = (n) => norm(n).toLowerCase().replace(/[^a-z0-9]/g, '');

const isSep = (l) => /^\s*(>\s*)?(#+\s*)?-{3,}\s*$/.test(l);
const headingRe = /^(#{1,6})\s+(.*)$/;
const realHeading = (l) => {
   const m = l.match(headingRe);
   return m && norm(m[2]) && norm(m[2]) !== '---' ? m : null;
};

/**
 * Parses the rules markdown into entries, one per heading from "# Equipment" onward. Level-5 headings are weapon
 * attacks and fold into their parent entry.
 * @param {string} md - The rules markdown.
 * @returns {{level: number, title: string, line: number, path: string[], header: {label: string, value: string}[],
 * attacks: {name: string, fields: {label: string, value: string}[]}[], body: string[]}[]} The entries: header
 * fields come from the leading bold `Label:` lines before the first `---` separator; body is the markdown lines
 * after it, up to the next heading.
 */
export function parseEntries(md) {
   const lines = md.split(/\r?\n/);
   const START = lines.findIndex((l) => l.startsWith('# Equipment'));
   const entries = [];
   const section = [];
   for (let i = START; i < lines.length; i++) {
      const m = realHeading(lines[i]);
      if (!m) {
         continue;
      }
      const level = m[1].length;
      const title = norm(m[2]);
      section[level] = title;
      section.length = level + 1;
      // Skip attack sub-headings; they are folded into their parent's header.
      if (level === 5) {
         continue;
      }
      const header = [];
      const attacks = [];
      let j = i + 1;
      let cur = null;
      let sawHeaderField = false;
      // Header region: until the first separator (or a paragraph that is not a field).
      for (; j < lines.length; j++) {
         const l = lines[j];
         if (isSep(l)) {
            j++;
            break;
         }
         const sub = realHeading(l);
         if (sub && sub[1].length === 5) {
            cur = {
               name: norm(sub[2]),
               fields: [],
            };
            attacks.push(cur);
            continue;
         }
         if (sub) {
            break;
         }
         const f = l.match(/^\s*\*\*([^*:]+):\*\*\s*(.*?)\s*$/) ?? l.match(/^\s*\*\*([A-Za-z ]+):\s*([^*]+)\*\*\s*$/) ?? l.match(/^\s*\*\*([A-Za-z ]+)\*\*:\s*(.*?)\s*$/);
         if (f) {
            sawHeaderField = true;
            (cur ? cur.fields : header).push({
               label: f[1].trim(),
               value: norm(f[2]),
            });
            continue;
         }
         const dc = l.match(/^\s*\*\*((?:Body|Mind|Soul)\s*\([^)]*\)\s*\d+:\d+)\*\*\s*$/);
         if (dc) {
            sawHeaderField = true;
            header.push({
               label: 'DC',
               value: norm(dc[1]),
            });
            continue;
         }
         if (l.trim() === '') {
            continue;
         }
         // A prose line before any separator: there is no header block.
         if (!sawHeaderField) {
            j = i + 1;
         }
         break;
      }
      const bodyStart = j;
      for (; j < lines.length; j++) {
         if (realHeading(lines[j])) {
            break;
         }
      }
      const body = lines.slice(bodyStart, j);
      while (body.length && (body.at(-1).trim() === '' || isSep(body.at(-1)))) {
         body.pop();
      }
      entries.push({
         level,
         title,
         line: i + 1,
         path: section.slice(1, level).filter(Boolean),
         header,
         attacks,
         body,
      });
   }
   return entries;
}

function inline(s) {
   const esc = (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c);
   let t = s.replace(/\\([+\-()*_#.!\[\]<>=~|])/g, (m, c) => '\u0000' + c.charCodeAt(0) + '\u0000');
   t = t
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
   t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
   t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
   t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
   t = t.replace(/\u0000(\d+)\u0000/g, (m, c) => esc(String.fromCharCode(Number(c))));
   return t.trim();
}

/**
 * Converts markdown body lines to Foundry-style HTML: paragraphs, two-level bullet lists (indented lines continue
 * the previous item), pipe tables, and bold/italic emphasis. Blockquote markers and separators are dropped.
 * @param {string[]} bodyLines - The markdown lines.
 * @returns {string} The HTML.
 */
export function mdToHtml(bodyLines) {
   const lines = bodyLines
      .filter((l) => !isSep(l))
      .map((l) => l.replace(/^\s*>\s?/, '').replace(/^\s*>\s?/, '').replace(/\s+$/, ''));
   const out = [];
   let i = 0;
   const listItem = (l) => l.match(/^(\s*)[*-]\s+(.*)$/);
   while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '') {
         i++;
         continue;
      }
      if (/^\|/.test(l)) {
         const rows = [];
         while (i < lines.length && /^\|/.test(lines[i])) {
            rows.push(lines[i]);
            i++;
         }
         const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
         const head = cells(rows[0]);
         const bodyRows = rows.slice(2).map(cells);
         out.push(
            `<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>` +
               bodyRows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') +
               '</tbody></table>',
         );
         continue;
      }
      if (listItem(l)) {
         // Collect list items (depth 0/1); indented non-item lines continue the previous item.
         const items = [];
         while (i < lines.length) {
            const cur = lines[i];
            if (cur.trim() === '') {
               let k = i + 1;
               while (k < lines.length && lines[k].trim() === '') {
                  k++;
               }
               if (k < lines.length && (listItem(lines[k]) || /^\s{2,}\S/.test(lines[k]))) {
                  i = k;
                  continue;
               }
               break;
            }
            const m = listItem(cur);
            if (m) {
               items.push({
                  depth: m[1].length >= 2 ? 1 : 0,
                  paras: [inline(m[2])],
               });
            }
            else if (/^\s{2,}\S/.test(cur) && items.length) {
               items.at(-1).paras.push(inline(cur));
            }
            else {
               break;
            }
            i++;
         }
         const li = (it) => it.paras.map((p) => `<p>${p}</p>`).join('');
         let html = '<ul>';
         let open = false;
         for (let k = 0; k < items.length; k++) {
            const it = items[k];
            if (it.depth === 1 && open) {
               const subs = [];
               while (k < items.length && items[k].depth === 1) {
                  subs.push(`<li>${li(items[k])}</li>`);
                  k++;
               }
               k--;
               html = html.replace(/<\/li>$/, `<ul>${subs.join('')}</ul></li>`);
               continue;
            }
            html += `<li>${li(it)}</li>`;
            open = true;
         }
         html += '</ul>';
         out.push(html);
         continue;
      }
      // Paragraph: consecutive non-blank lines (hard breaks with trailing double-space become one paragraph each).
      out.push(`<p>${inline(l)}</p>`);
      i++;
   }
   return out.join('');
}

/**
 * Reduces HTML to normalized plain text.
 * @param {string} [h] - The HTML.
 * @returns {string} The normalized text.
 */
export function htmlText(h) {
   return norm(
      (h ?? '')
         .replace(/<\/?(p|li|ul|ol|h\d|div|tr|td|th|table|tbody|thead|blockquote|hr)[^>]*>/gi, ' ')
         .replace(/<br\s*\/?>/gi, ' ')
         .replace(/<[^>]+>/g, ''),
   );
}
/**
 * Reduces markdown body lines to normalized plain text, through the same HTML conversion the packs use.
 * @param {string[]} bodyLines - The markdown lines.
 * @returns {string} The normalized text.
 */
export const mdText = (bodyLines) => htmlText(mdToHtml(bodyLines));

/**
 * Yields every JSON file under a directory, recursively.
 * @param {string} d - The directory.
 * @yields {string} Each JSON file path.
 */
export function* walk(d) {
   for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
         yield* walk(p);
      }
      else if (p.endsWith('.json')) {
         yield p;
      }
   }
}

/**
 * Loads every document source under a packs root.
 * @param {string} dir - The packs root (one folder per pack).
 * @returns {{pack: string, f: string, d: object}[]} Each document with its pack name and file path.
 */
export function loadDocs(dir) {
   const docs = [];
   for (const pack of fs.readdirSync(dir)) {
      for (const f of walk(path.join(dir, pack))) {
         docs.push({
            pack,
            f,
            d: JSON.parse(fs.readFileSync(f, 'utf8')),
         });
      }
   }
   return docs;
}

/**
 * Word-level diff of two normalized texts. Algorithm: longest common subsequence by dynamic programming.
 * @param {string} a - The old text.
 * @param {string} b - The new text.
 * @returns {string[]} One `[-removed-] {+added+} @ …context` line per changed run; empty when equal.
 */
export function wdiff(a, b) {
   const A = a.split(' ');
   const B = b.split(' ');
   const n = A.length;
   const m = B.length;
   const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
   for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
         dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
   }
   const out = [];
   let i = 0;
   let j = 0;
   let del = [];
   let ins = [];
   const flush = (ctx) => {
      if (del.length || ins.length) {
         out.push(`  [-${del.join(' ')}-] {+${ins.join(' ')}+}  @ …${ctx}`);
      }
      del = [];
      ins = [];
   };
   while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) {
         flush(A.slice(Math.max(0, i - 4), i + 1).join(' '));
         i++;
         j++;
      }
      else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
         ins.push(B[j++]);
      }
      else {
         del.push(A[i++]);
      }
   }
   flush('END');
   return out;
}

/**
 * Splits a pack description into its leading `<p><strong>Label:</strong> value</p>` fields and the remaining HTML.
 * @param {string} [html] - The description HTML.
 * @returns {{fields: {label: string, value: string}[], rest: string}} The header fields and the body HTML.
 */
export function splitPackDescription(html) {
   const fields = [];
   let rest = html ?? '';
   for (;;) {
      const m = rest.match(/^\s*<p>\s*<strong>\s*([^<:]+?)\s*:\s*<\/strong>\s*(.*?)<\/p>/s);
      if (!m) {
         break;
      }
      fields.push({
         label: m[1].trim(),
         value: htmlText(m[2]),
      });
      rest = rest.slice(m[0].length);
   }
   return {
      fields,
      rest,
   };
}
