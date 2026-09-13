# ADR-0005: Each profile keeps a routine list

- **Status**: accepted
- **Date**: 2026-09-13
- **Amends**: the *Routine* entry and rule 1 of `CONTEXT.md` (routines shared by, and
  shown to, every profile)

## Context

Every routine was shown to every profile. Andrew doesn't want every workout
visible to everyone, so **＋ New routine** should offer a list of the routines
that already exist to pick from, alongside creating one from nothing as the
editor does today.

That leaves the question of what picking gives someone. Three answers were weighed:

- **the same shared routine**, joining their list, with Delete taking it off their
  list alone;
- **the same shared routine**, with Delete still deleting it for everyone; or
- **a copy of their own**, which no one else's edit ever touches, but which also
  never gets anyone else's fix and needs a name of its own.

Andrew chose **the same shared routine, with Delete taking it off their list
alone**.

## Decision

**Every routine stays in one shared routine library, and each profile has a
routine list:** `profile_routine (profile_id, routine_id)`. A profile's routine
list shows only the routines on its list. **＋ New routine** shows the library's
routines not on the list yet, each with **Add**, and then **＋ Create new**, which
opens the editor. A new routine goes on its creator's list alone.

**A routine is still shared.** Its shape is the same on every list it is on, an edit
reaches all of them, and weights stay personal, held at the slot's position behind
ADR-0004's ⚠️.

**Remove replaces Delete.** The editor takes a routine off the editing profile's list
and nothing more. The routine stays in the library for anyone to add again, and so do
that profile's weights on it, so adding it back finds them where they were. The
delete-for-everyone endpoint and its ⚠️ are gone: nothing in the app deletes a
routine any more.

**Migration 4** puts every existing routine on every existing profile's list, so
nobody's list changes on the update. A profile created later starts with an empty
list.

## Consequences

- A list is a **view, not a lock**. There are no passwords, so any profile can still
  start or edit any routine by its id; the app only shows each person their own.
- The library only grows. A routine nobody has on their list any more still shows
  under ＋ New routine.
- Routine names stay unique across the whole library, so creating a routine is
  refused if the name is taken by one on someone else's list. The routine with that
  name is there to add under ＋ New routine instead.
- Someone who removed a routine keeps their weights on it, so they still appear in
  the ⚠️ when another profile's edit would move or delete them.
- `GET /api/profiles` carries each profile's `routine_ids`, and `GET /api/routines`
  is the whole library: the app splits one by the other, with no load of its own
  for a list.
