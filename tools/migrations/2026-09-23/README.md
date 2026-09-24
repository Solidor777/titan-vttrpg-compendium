# 2026-09-23 migration

This migration updated the v11 packs (commit `817959f`) to the 2026-09-23 rules and the TITAN v14 system. Its
output, after live validation, is the current `src/packs`. The scripts are kept as a record, and they still
reproduce `src/packs` exactly. They are not the tools for ongoing edits: edit `src/packs` directly.

| Stage | Script | Reads | Writes |
|---|---|---|---|
| 1 | `reconcile.mjs` | `src-orig/`, rules markdown | `reconcile-state.json`, `reconcile-log.txt` |
| 2 | `build2.mjs` | `reconcile-state.json` | `stage2.json`, `stage2-log.txt` |
| 3 | `build3.mjs` | `stage2.json`, rules markdown | `src-new/`, `stage3-log.txt` |

- **Stage 1** handles deletions and renames. It rebuilds descriptions from the rules, and reconciles traits,
  rarity, values, weapon attacks, armor, and spells.
- **Stage 2** converts the legacy effect items into Active Effects, fixes values in the conjured weapons, and
  links each item to its effects.
- **Stage 3** adds the new content (Deathsinger, Zephyr Style, Cleansing Light), fixes checks, and rebuilds the
  Rules journal.

Every path is under `.work/migration-2026-09-23/`. To rerun, starting from the module root with a live
Foundry world:

```sh
mkdir -p .work/migration-2026-09-23
git -c core.autocrlf=false archive 817959f packs | tar -x -C .work/migration-2026-09-23
mv .work/migration-2026-09-23/packs .work/migration-2026-09-23/modpacks-orig
node tools/extract-packs.mjs .work/migration-2026-09-23/modpacks-orig .work/migration-2026-09-23/src-orig
export RULES_FILE="<path to TITAN Rules Compendium - Source - 09_23_2026.md>"
node tools/migrations/2026-09-23/reconcile.mjs
node tools/migrations/2026-09-23/build2.mjs
node tools/migrations/2026-09-23/build3.mjs
npm run validate -- .work/migration-2026-09-23/src-new .work/validated
```

`.work/validated` should then match `src/packs` exactly. Ids come from a hash of fixed seeds (`ids.mjs`), so
every rerun produces the same ids.
