# Vendored from kickr

Copied from `~/kickr` at commit `300b8d81dd31ad5423101a03d1037df5c5f572aa` **plus its uncommitted working tree as of 2026-10-26** (the working tree was ahead of HEAD: render.ts, sim.ts, game.ts, protocol.ts, stadium.ts had local changes).

Files keep kickr's relative layout so their imports work unchanged:

- `shared/`: flags.ts, stadium.ts, physics.ts, game.ts, protocol.ts, stadiums/*.hbs
- `client/`: render.ts, sim.ts, settings.ts, store.ts, images/*.png

## Local changes (keep this list exhaustive)

Only `export` keywords were added, so the editor can reuse internals:

- `shared/stadium.ts`: `withTrait`, `compileSegment`, `DISC_DEFAULTS`, `compileDisc`
- `client/render.ts`: `drawBackground`, `roundedRect`

To update: copy the same files again from kickr, reapply the exports above, run `bun test`.
