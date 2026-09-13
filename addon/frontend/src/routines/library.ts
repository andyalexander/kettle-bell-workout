import type { Profile, RoutineSummary } from "../api";

/** The routine library as one profile sees it (ADR-0005). */
export interface SplitLibrary {
  /** The routines on the profile's list: its routine list. */
  readonly listed: readonly RoutineSummary[];
  /** The rest, for ＋ New routine to offer. */
  readonly unlisted: readonly RoutineSummary[];
}

/** Split the library by a profile's list, each half in the library's own order. */
export function splitLibrary(routines: readonly RoutineSummary[], profile: Profile): SplitLibrary {
  const onList = new Set(profile.routine_ids);
  return {
    listed: routines.filter(({ id }) => onList.has(id)),
    unlisted: routines.filter(({ id }) => !onList.has(id)),
  };
}
