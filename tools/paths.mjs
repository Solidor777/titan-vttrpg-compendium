// Shared filesystem locations for the pack tools. Every path resolves from the module root, so the tools run
// from any working directory.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {string} The module root directory (the folder holding module.json). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {string} The JSON pack sources: one folder per pack, one file per document (the source of truth). */
export const SRC_PACKS = path.join(ROOT, 'src', 'packs');

/** @type {string} The compiled LevelDB packs Foundry loads, as listed in module.json. */
export const PACKS = path.join(ROOT, 'packs');

/** @type {string} Scratch space for intermediate tool output; git-ignored and safe to clear. */
export const WORK = path.join(ROOT, '.work');

/** @type {string} The Foundry server the live-client tools log in to. */
export const FOUNDRY_URL = process.env.FOUNDRY_URL ?? 'http://localhost:30000';

/** @type {string} The Foundry user the live-client tools log in as; must be a GM with no other open session. */
export const FOUNDRY_USER = process.env.FOUNDRY_USER ?? 'Gamemaster';
