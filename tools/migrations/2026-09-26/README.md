# 2026-09-26 migration

Brings `src/packs` from the 2026-09-23 rules to the 2026-09-26 rules. It is a record; it reproduces this change
from the 2026-09-23 sources and is not the tool for ongoing edits.

`apply.mjs` reads `src/packs` and the rules markdown (`RULES_FILE`), then writes every changed or new document to
`.work/migration-2026-09-26/src-new/`, with `log.txt` and `renames.txt`. Copy `src-new` over `src/packs` and move each
renamed file's old copy to the recycle bin.

What it does:

- Renames the `Combat Style` trait to `Martial Style` on every document that carries it.
- Renames Flinging Updraft (ability) to Fleeing Updraft, and the effects folder Combat Styles to Martial Styles.
- Rebuilds descriptions that changed: Zephyr Style, Living Whirlwind, Fox Fire; edits the Zephyr Style and Fox Fire
  effects to match.
- Adds the general abilities Mnemonic Recital and Thrifty Spirit.
- Adds Path of the Mystwalker (path, 12 abilities, 1 apex) with its effects.
- Adds Frost Dragon Style, Inferno Style, and Mountain King Style, each with its style effect, abilities, and mythic
  technique.
- Rebuilds the Rules journal (`tools/rules/journal.mjs`), adding a Martial Styles page.

Source corrections applied on request (the rules document still has the originals): `Borrow the Flame` to
`Borrow the Flames`, `Channel the Blaze` to `Channel the Flames`, Hunger of Urdokai's range from Touch to 10 spaces,
and the repeated words in the Stunned condition. The nameless ability between Conjurer of Urdokai and Mirror of
Urdokai (a copy of Fangs of Urdokai) is skipped.
