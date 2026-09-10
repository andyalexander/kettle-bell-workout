"""Progress metrics, as pure folds over recorded workouts.

Nothing here joins to a routine or a slot, so no metric can change value because
somebody edited a routine — which is the whole point of ADR-0001. Every function
takes workouts already read out of the database and returns a value; they are
pure, so they are cheap to test and safe to call from anywhere.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from kettlebell.models import RecordedWorkout

__all__ = [
    "ExercisePoint",
    "ProfileProgress",
    "consecutive_week_streak",
    "days_since_last_workout",
    "exercise_series",
    "profile_progress",
    "time_under_load_since",
]


@dataclass(frozen=True, slots=True)
class ProfileProgress:
    """The lifetime picture of one profile — the five sensors #6 settled on.

    Deliberately lifetime, not windowed: we publish only on completion, so a
    "this week" value would go stale and silently wrong for days. Home Assistant
    derives the weekly count from the lifetime totals for free.
    """

    workouts: int
    time_under_load: int
    last_workout: datetime | None
    last_routine: str | None
    last_time_under_load: int | None


def profile_progress(recorded: Sequence[RecordedWorkout]) -> ProfileProgress:
    """Fold one profile's whole history into the numbers HA is told about."""
    if not recorded:
        return ProfileProgress(
            workouts=0,
            time_under_load=0,
            last_workout=None,
            last_routine=None,
            last_time_under_load=None,
        )
    latest = max(recorded, key=lambda entry: entry.started_at)
    return ProfileProgress(
        workouts=len(recorded),
        time_under_load=sum(entry.workout.time_under_load for entry in recorded),
        last_workout=latest.ended_at,
        last_routine=latest.workout.routine_name,
        last_time_under_load=latest.workout.time_under_load,
    )


def time_under_load_since(recorded: Iterable[RecordedWorkout], start: datetime) -> int:
    """Seconds of work over every workout that started at or after `start`.

    The rolling weekly and monthly figures the app charts are this function with
    a different `start`; neither is published to Home Assistant.
    """
    return sum(
        entry.workout.time_under_load for entry in recorded if entry.started_at >= start
    )


def days_since_last_workout(
    recorded: Sequence[RecordedWorkout], today: date
) -> int | None:
    """Whole days between the last workout and `today`, or None if never trained."""
    if not recorded:
        return None
    latest = max(entry.started_at for entry in recorded)
    return (today - latest.date()).days


def consecutive_week_streak(recorded: Sequence[RecordedWorkout], today: date) -> int:
    """Consecutive ISO weeks with at least one workout, counted back from now.

    A streak is not broken until the week actually ends, so a week with no
    training yet does not reset the count — it just does not extend it.
    """
    trained = {_iso_week(entry.started_at.date()) for entry in recorded}
    if not trained:
        return 0
    cursor = today
    if _iso_week(cursor) not in trained:
        cursor -= timedelta(days=7)
    streak = 0
    while _iso_week(cursor) in trained:
        streak += 1
        cursor -= timedelta(days=7)
    return streak


@dataclass(frozen=True, slots=True)
class ExercisePoint:
    """One workout's contribution to one exercise's trend."""

    when: datetime
    exercise_name: str
    time_under_load: int
    top_weight: float


def exercise_series(
    recorded: Iterable[RecordedWorkout],
) -> dict[int, list[ExercisePoint]]:
    """Per-exercise time under load and top weight over time, oldest first.

    Keyed on the `exercise_id` frozen into each activity, so a trend survives a
    rename; the name carried on each point is the one used at the time. An
    activity contributes `rounds * work_seconds`, so an exercise appearing twice
    in one workout counts twice — which is what actually happened to the athlete.
    """
    series: dict[int, list[ExercisePoint]] = defaultdict(list)
    for entry in recorded:
        workout = entry.workout
        per_activity = workout.rounds * workout.work_seconds
        totals: dict[int, tuple[str, int, float]] = {}
        for activity in workout.activities:
            name, seconds, top = totals.get(
                activity.exercise_id, (activity.exercise_name, 0, 0.0)
            )
            totals[activity.exercise_id] = (
                name,
                seconds + per_activity,
                max(top, activity.weight),
            )
        for exercise_id, (name, seconds, top) in totals.items():
            series[exercise_id].append(
                ExercisePoint(
                    when=entry.started_at,
                    exercise_name=name,
                    time_under_load=seconds,
                    top_weight=top,
                )
            )
    for points in series.values():
        points.sort(key=lambda point: point.when)
    return dict(series)


def _iso_week(day: date) -> tuple[int, int]:
    year, week, _ = day.isocalendar()
    return year, week
