from datetime import UTC, date, datetime, timedelta

import pytest

from kettlebell import metrics
from kettlebell.models import Prescription, PrescriptionSlot, Session

SWING = PrescriptionSlot(
    position=0, exercise_id=1, exercise_name="Two-hand swing", reps=10, weight=24
)
CLEAN = PrescriptionSlot(
    position=1, exercise_id=2, exercise_name="Double clean", reps=5, weight=20
)


def _prescription(name: str = "Monday", rounds: int = 4) -> Prescription:
    return Prescription(
        routine_id=1,
        routine_name=name,
        rounds=rounds,
        work_seconds=60,
        rest_seconds=0,
        slots=(SWING, CLEAN),
    )


def _session(
    session_id: int, when: datetime, prescription: Prescription | None = None
) -> Session:
    return Session(
        id=session_id,
        profile_id=1,
        started_at=when,
        ended_at=when + timedelta(minutes=8),
        prescription=_prescription() if prescription is None else prescription,
    )


def test_progress_of_a_profile_that_has_never_trained() -> None:
    progress = metrics.profile_progress([])
    assert progress.sessions == 0
    assert progress.volume == 0.0
    assert progress.last_workout is None
    assert progress.last_routine is None


def test_progress_folds_lifetime_totals_and_the_latest_workout() -> None:
    older = _session(1, datetime(2026, 9, 1, 7, 0, tzinfo=UTC))
    newer = _session(
        2,
        datetime(2026, 9, 8, 7, 0, tzinfo=UTC),
        _prescription(name="Friday", rounds=2),
    )

    progress = metrics.profile_progress([older, newer])
    assert progress.sessions == 2
    assert progress.volume == pytest.approx(1360.0 + 680.0)
    assert progress.last_routine == "Friday"
    assert progress.last_volume == pytest.approx(680.0)
    assert progress.last_workout == newer.ended_at


def test_volume_since_ignores_older_sessions() -> None:
    older = _session(1, datetime(2026, 9, 1, 7, 0, tzinfo=UTC))
    newer = _session(2, datetime(2026, 9, 8, 7, 0, tzinfo=UTC))
    cutoff = datetime(2026, 9, 5, tzinfo=UTC)
    assert metrics.volume_since([older, newer], cutoff) == pytest.approx(1360.0)


def test_days_since_last_workout() -> None:
    session = _session(1, datetime(2026, 9, 6, 7, 0, tzinfo=UTC))
    assert metrics.days_since_last_workout([session], date(2026, 9, 9)) == 3
    assert metrics.days_since_last_workout([], date(2026, 9, 9)) is None


def test_a_streak_counts_consecutive_iso_weeks() -> None:
    weeks = [
        _session(index, datetime(2026, 9, 9, tzinfo=UTC) - timedelta(days=7 * index))
        for index in range(3)
    ]
    assert metrics.consecutive_week_streak(weeks, date(2026, 9, 9)) == 3


def test_a_gap_ends_the_streak() -> None:
    this_week = _session(1, datetime(2026, 9, 9, tzinfo=UTC))
    long_ago = _session(2, datetime(2026, 8, 5, tzinfo=UTC))
    assert metrics.consecutive_week_streak([this_week, long_ago], date(2026, 9, 9)) == 1


def test_a_quiet_week_does_not_break_a_streak_until_it_ends() -> None:
    last_week = _session(1, datetime(2026, 9, 2, tzinfo=UTC))
    # Monday of the following week: nothing trained yet, but the run is alive.
    assert metrics.consecutive_week_streak([last_week], date(2026, 9, 7)) == 1
    assert metrics.consecutive_week_streak([last_week], date(2026, 9, 16)) == 0


def test_exercise_series_keys_on_the_frozen_id_and_keeps_the_old_name() -> None:
    first = _session(1, datetime(2026, 9, 1, 7, 0, tzinfo=UTC))
    renamed = PrescriptionSlot(
        position=0, exercise_id=1, exercise_name="Swing (renamed)", reps=10, weight=32
    )
    second = Session(
        id=2,
        profile_id=1,
        started_at=datetime(2026, 9, 8, 7, 0, tzinfo=UTC),
        ended_at=datetime(2026, 9, 8, 7, 8, tzinfo=UTC),
        prescription=Prescription(
            routine_id=1,
            routine_name="Monday",
            rounds=1,
            work_seconds=60,
            rest_seconds=0,
            slots=(renamed,),
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
    assert swings[0].volume == pytest.approx(960.0)


def test_repeated_slots_of_one_exercise_sum_within_a_session() -> None:
    twice = Prescription(
        routine_id=1,
        routine_name="Ladder",
        rounds=2,
        work_seconds=40,
        rest_seconds=20,
        slots=(
            SWING,
            PrescriptionSlot(
                position=1,
                exercise_id=1,
                exercise_name="Two-hand swing",
                reps=8,
                weight=32,
            ),
        ),
    )
    session = _session(1, datetime(2026, 9, 1, tzinfo=UTC), twice)
    point = metrics.exercise_series([session])[1][0]
    assert point.volume == pytest.approx(2 * (10 * 24 + 8 * 32))
    assert point.top_weight == 32.0
