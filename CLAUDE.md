# Kettlebell Workout

A Home Assistant add-on for running EMOM and interval kettlebell workouts, used on
iPhone/iPad on the home network. FastAPI + SQLite backend, React + TypeScript +
Tailwind front end, single container on its own port. Workout results are published
over MQTT so progress is visible inside Home Assistant.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`andyalexander/kettle-bell-workout`), driven
via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context — root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.
