# TITAN VTTRPG Compendium

Compendium content for the TITAN VTTRPG system on Foundry VTT v13–v14.

## Packs

| Pack | Type | Contents |
|---|---|---|
| Rules | Journal | The rules reference: character creation, statistics, checks, actions, combat, conditions, traits, equipment, the arcane and sacred arts. |
| Abilities | Item | General abilities. |
| Sacred Arts | Item | Paths, path abilities, and apex abilities, one folder per path. |
| Combat Styles | Item | Combat styles and their techniques, one folder per style. |
| Spells | Item | Spells, one folder per tradition, plus the weapons some spells conjure. |
| Weapons | Item | Melee and ranged weapons. |
| Armor and Shields | Item | Armor and shields. |
| Urderic Items | Item | Urderic armor and weapons. |
| Effects | Active Effect | Effects applied by abilities, sacred arts, and spells, mirrored into the same folder layout. |
| Summons | Actor | Creatures called by abilities. |

Every ability or spell that applies an effect links to it at the end of its description; drag the link (or the
effect from the Effects pack) onto a character to apply it.

## Editing the packs

The JSON files in `src/packs/` are the source of truth: one folder per pack, one file per document. The LevelDB
databases in `packs/` are compiled from them. Run `npm install` once, then use the scripts below.

| Command | Does |
|---|---|
| `npm run packs:compile` | Compiles `src/packs` into `packs`. Foundry must not have the packs open. |
| `npm run check:links` | Checks that every `@UUID` link resolves to a document, page, and heading in this module. |
| `npm run validate` | Builds every document strictly inside a running Foundry world with TITAN, without saving anything, then runs derived data on one actor carrying every item and effect. Writes the migrated sources to `.work/validated`. Set `FOUNDRY_USER` (a GM with no other open session) and, if needed, `FOUNDRY_URL` and `FOUNDRY_PASSWORD`. |
| `npm run rules:compare -- <rules.md>` | Word-diffs every description against a TITAN Rules Compendium markdown export, writing `.work/compare-report.txt`. |
| `npm run packs:extract` | Extracts `packs` into `.work/extracted`, for pulling in edits made inside Foundry. |
| `npm run zip` | Packages `module.json`, `README.md`, `icons/`, and `packs/` into `titan-vttrpg-compendium.zip`. |

The tools never delete files. Output folders must be empty, and `.work/` is scratch space you can clear.
`tools/migrations/` records one-off migrations; see the README in each folder.
