from datetime import UTC, date, datetime, timedelta

from kettlebell import metrics
from kettlebell.models import Activity, RecordedWorkout, Workout

SWING = Activity(
    position=0, exercise_id=1, exercise_name="Two-hand swing", reps=10, weight=24
)
CLEAN = Activity(
    position=1, exercise_id=2, exercise_name="Double clean", reps=5, weight=20
)


def _workout(name: str = "Monday", rounds: int = 4) -> Workout:
    return Workout(
        routine_id=1,
        routine_name=name,
        rounds=rounds,
        work_seconds=60,
        rest_seconds=0,
        activities=(SWING, CLEAN),
    )


def _recorded(
    workout_id: int, when: datetime, workout: Workout | None = None
) -> RecordedWorkout:
    return RecordedWorkout(
        id=workout_id,
        profile_id=1,
        started_at=when,
        ended_at=when + timedelta(minutes=8),
        workout=_workout() if workout is None else workout,
    )


def test_progress_of_a_profile_that_has_never_trained() -> None:
    progress = metrics.profile_progress([])
    assert progress.workouts == 0
    assert progress.time_under_load == 0
    assert progress.last_workout is None
    assert progress.last_routine is None


def test_progress_folds_lifetime_totals_and_the_latest_workout() -> None:
    older = _recorded(1, datetime(2026, 9, 1, 7, 0, tzinfo=UTC))
    newer = _recorded(
        2,
        datetime(2026, 9, 8, 7, 0, tzinfo=UTC),
        _workout(name="Friday", rounds=2),
    )

    progress = metrics.profile_progress([older, newer])
    assert progress.workouts == 2
    # Four rounds of two activities at 60s, then two rounds of the same: 480 + 240.
    assert progress.time_under_load == 480 + 240
    assert progress.last_routine == "Friday"
    assert progress.last_time_under_load == 240
    assert progress.last_workout == newer.ended_at


def test_time_under_load_since_ignores_older_workouts() -> None:
    older = _recorded(1, datetime(2026, 9, 1, 7, 0, tzinfo=UTC))
    newer = _recorded(2, datetime(2026, 9, 8, 7, 0, tzinfo=UTC))
    cutoff = datetime(2026, 9, 5, tzinfo=UTC)
    assert metrics.time_under_load_since([older, newer], cutoff) == 480


def test_a_repless_workout_still_has_time_under_load() -> None:
    """The whole point of retiring volume (ADR-0002): carries still count."""
    carry = Activity(
        position=0, exercise_id=9, exercise_name="Farmer's carry", reps=None, weight=16
    )
    workout = Workout(
        routine_id=2,
        routine_name="Carries",
        rounds=3,
        work_seconds=40,
        rest_seconds=20,
        activities=(carry,),
    )
    recorded = _recorded(1, datetime(2026, 9, 8, 7, 0, tzinfo=UTC), workout)
    assert metrics.profile_progress([recorded]).time_under_load == 120


def test_days_since_last_workout() -> None:
    recorded = _recorded(1, datetime(2026, 9, 6, 7, 0, tzinfo=UTC))
    assert metrics.days_since_last_workout([recorded], date(2026, 9, 9)) == 3
    assert metrics.days_since_last_workout([], date(2026, 9, 9)) is None


def test_a_streak_counts_consecutive_iso_weeks() -> None:
    weeks = [
        _recorded(index, datetime(2026, 9, 9, tzinfo=UTC) - timedelta(days=7 * index))
        for index in range(3)
    ]
    assert metrics.consecutive_week_streak(weeks, date(2026, 9, 9)) == 3


def test_a_gap_ends_the_streak() -> None:
    this_week = _recorded(1, datetime(2026, 9, 9, tzinfo=UTC))
    long_ago = _recorded(2, datetime(2026, 8, 5, tzinfo=UTC))
    assert metrics.consecutive_week_streak([this_week, long_ago], date(2026, 9, 9)) == 1


def test_a_quiet_week_does_not_break_a_streak_until_it_ends() -> None:
    last_week = _recorded(1, datetime(2026, 9, 2, tzinfo=UTC))
    # Monday of the following week: nothing trained yet, but the run is alive.
    assert metrics.consecutive_week_streak([last_week], date(2026, 9, 7)) == 1
    assert metrics.consecutive_week_streak([last_week], date(2026, 9, 16)) == 0


def test_exercise_series_keys_on_the_frozen_id_and_keeps_the_old_name() -> None:
    first = _recorded(1, datetime(2026, 9, 1, 7, 0, tzinfo=UTC))
    renamed = Activity(
        position=0, exercise_id=1, exercise_name="Swing (renamed)", reps=10, weight=32
    )
    second = RecordedWorkout(
        id=2,
        profile_id=1,
        started_at=datetime(2026, 9, 8, 7, 0, tzinfo=UTC),
        ended_at=datetime(2026, 9, 8, 7, 8, tzinfo=UTC),
        workout=Workout(
            routine_id=1,
            routine_name="Monday",
            rounds=1,
            work_seconds=60,
            rest_seconds=0,
            activities=(renamed,),
        ),
    )

    series = metrics.exercise_series([second, first])
    swings = series[1]
    assert [point.when for point in swings] == [first.started_at, second.started_at]
    assert [point.exercise_name for point in swings] == [
        "Two-hand swing",
        "Swing (renamed)",
    ]
    assert [point.top_weight for point in swings] == [24.0, 32.0]
    # First workout: 4 rounds at 60s on that one activity.
    assert swings[0].time_under_load == 240


def test_repeated_activities_of_one_exercise_sum_within_a_workout() -> None:
    twice = Workout(
        routine_id=1,
        routine_name="Ladder",
        rounds=2,
        work_seconds=40,
        rest_seconds=20,
        activities=(
            SWING,
            Activity(
                position=1,
                exercise_id=1,
                exercise_name="Two-hand swing",
                reps=8,
                weight=32,
            ),
        ),
    )
    recorded = _recorded(1, datetime(2026, 9, 1, tzinfo=UTC), twice)
    point = metrics.exercise_series([recorded])[1][0]
    # Two activities of the same exercise, two rounds, 40s of work each.
    assert point.time_under_load == 2 * 2 * 40
    assert point.top_weight == 32.0
