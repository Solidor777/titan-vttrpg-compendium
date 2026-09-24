// Locations shared by the 2026-09-23 migration stages. See README.md in this folder for the run order.
import fs from 'node:fs';
import path from 'node:path';
import { WORK } from '../../paths.mjs';

/** @type {string} The migration's working directory: src-orig in, stage state and logs, src-new out. */
export const STAGE = path.join(WORK, 'migration-2026-09-23');

/**
 * Reads the rules markdown the migration reconciles against, named by the RULES_FILE environment variable.
 * @returns {string} The rules markdown.
 */
export function readRules() {
   if (!process.env.RULES_FILE) {
      throw new Error('Set RULES_FILE to the TITAN Rules Compendium markdown path.');
   }
   return fs.readFileSync(process.env.RULES_FILE, 'utf8');
}
