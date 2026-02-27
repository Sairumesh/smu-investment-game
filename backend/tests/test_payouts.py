from types import SimpleNamespace

import pytest

from app.services.game_service import GameService


def make_player(idx: int, allocation_a: int, allocation_b: int):
    return SimpleNamespace(
        id=f"p{idx}",
        display_name=f"Player {idx}",
        allocation_a=allocation_a,
        allocation_b=allocation_b,
    )


def test_two_player_opposite_allocations():
    players = [make_player(1, 100, 0), make_player(2, 0, 100)]

    result = GameService.calculate_payouts(players)

    assert result.total_b_pool == 100
    assert result.boosted_pool == 150.0
    payouts = {p.player_id: p.payout for p in result.players}
    assert payouts["p1"] == 175.0
    assert payouts["p2"] == 75.0


def test_equal_split_four_players():
    players = [make_player(i, 50, 50) for i in range(1, 5)]

    result = GameService.calculate_payouts(players)

    assert result.total_b_pool == 200
    assert pytest.approx(result.boosted_pool, rel=1e-3) == 300.0
    payouts = [p.payout for p in result.players]
    assert all(value == 125.0 for value in payouts)


def test_rounding_handles_decimals():
    players = [make_player(1, 20, 80), make_player(2, 70, 30), make_player(3, 10, 90)]

    result = GameService.calculate_payouts(players)

    assert result.total_b_pool == 200
    assert result.boosted_pool == 300.0
    payouts = {p.player_id: p.payout for p in result.players}
    # boosted pool share per player = 100
    assert payouts["p1"] == 120.0
    assert payouts["p2"] == 170.0
    assert payouts["p3"] == 110.0
