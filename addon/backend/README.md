# Kettlebell backend

FastAPI application for the Kettlebell Trainer Home Assistant app. See the repo root
`CONTEXT.md` for the domain vocabulary this code uses.

```bash
uv sync
uv run pytest
uv run ruff check .
uv run pyright
```

## The persistence layer

| Module | What it holds |
| --- | --- |
| `db.py` | Connection pragmas, and the migrations keyed by `PRAGMA user_version` |
| `models.py` | Frozen domain types, named as `CONTEXT.md` names them |
| `store.py` | Everything still editable: profiles, exercises, routines, slots, overrides |
| `workouts.py` | Fixing a workout at start, and recording it when it completes |
| `metrics.py` | Progress metrics, as pure folds over recorded workouts |
| `avatars.py` | Downscaling an uploaded avatar before it goes into the profile row |

Two things are worth knowing before reading the code:

- **Migrations run at startup**, from the app's lifespan, so an add-on update that
  ships a new migration applies it on the restart that follows. Add one by appending
  a script to `MIGRATIONS`; never edit a script that has shipped.
- **A workout is fixed at start but written at the end.** Aborting a workout writes
  nothing at all, so `workout.ended_at` is NOT NULL and a half-finished workout
  cannot be represented — that is `CONTEXT.md` rule 3 expressed in the schema, and
  it is what will change when abandoned workouts get modelled.
