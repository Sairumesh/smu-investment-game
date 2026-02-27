from __future__ import annotations

from datetime import datetime, timezone
import random
import string
from typing import Sequence

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.game import Player, Room
from app.schemas.game import GameResult, PlayerPayout, RoomCreate

STATUS_WAITING = "waiting"
STATUS_READY = "ready"
STATUS_COMPLETED = "completed"


def _generate_room_code(length: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))


class GameService:
    def __init__(self, db: Session):
        self.db = db

    def create_room(self, payload: RoomCreate) -> Room:
        code = self._unique_room_code()
        room = Room(code=code, max_players=payload.max_players, status=STATUS_WAITING)
        self.db.add(room)
        self.db.commit()
        self.db.refresh(room)
        return room

    def get_room(self, code: str) -> Room:
        room = self.db.get(Room, code)
        if not room:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
        return room

    def join_room(self, code: str, display_name: str) -> Player:
        room = self.get_room(code)
        current_players = self._count_players(code)
        if current_players >= room.max_players:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Room is full")

        player = Player(room_code=room.code, display_name=display_name)
        self.db.add(player)
        self.db.commit()
        self.db.refresh(player)

        if current_players + 1 == room.max_players:
            room.status = STATUS_READY
            self.db.add(room)
            self.db.commit()

        return player

    def submit_allocation(
        self, code: str, player_id: str, asset_a: int, asset_b: int
    ) -> tuple[Player, GameResult | None]:
        if asset_a + asset_b != 100:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A + B must equal 100")

        player = self.db.get(Player, player_id)
        if not player or player.room_code != code:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

        room = self.get_room(code)
        total_players = self._count_players(code)
        if total_players < 2:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Need at least two players")

        if player.submitted_at is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Allocation already submitted")

        player.allocation_a = asset_a
        player.allocation_b = asset_b
        player.submitted_at = datetime.now(timezone.utc)
        self.db.add(player)
        self.db.commit()
        self.db.refresh(player)

        result: GameResult | None = None
        if self._all_players_submitted(room):
            result = self._finalize_room(room)

        return player, result

    def leave_room(self, code: str, player_id: str) -> tuple[Player, Room]:
        player = self.db.get(Player, player_id)
        if not player or player.room_code != code:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

        room = self.get_room(code)
        if room.status == STATUS_COMPLETED:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Game already completed")

        self.db.delete(player)
        self.db.commit()

        remaining = self._count_players(code)
        if remaining < room.max_players and room.status == STATUS_READY:
            room.status = STATUS_WAITING
            self.db.add(room)
            self.db.commit()

        return player, room

    def _finalize_room(self, room: Room) -> GameResult:
        players = (
            self.db.execute(
                select(Player).where(Player.room_code == room.code).order_by(Player.joined_at)
            )
            .scalars()
            .all()
        )
        result = self.calculate_payouts(players)
        for payout in result.players:
            player = next(p for p in players if p.id == payout.player_id)
            player.payout = payout.payout
            self.db.add(player)
        room.status = STATUS_COMPLETED
        self.db.add(room)
        self.db.commit()
        return result

    def list_players(self, code: str) -> list[Player]:
        self.get_room(code)
        players = (
            self.db.execute(select(Player).where(Player.room_code == code).order_by(Player.joined_at))
            .scalars()
            .all()
        )
        return players

    def _all_players_submitted(self, room: Room) -> bool:
        total = self._count_players(room.code)
        if total < room.max_players or total < 2:
            return False
        submitted = self.db.scalar(
            select(func.count())
            .select_from(Player)
            .where(Player.room_code == room.code, Player.submitted_at.is_not(None))
        )
        return submitted == total

    def _count_players(self, code: str) -> int:
        return self.db.scalar(select(func.count()).select_from(Player).where(Player.room_code == code)) or 0

    def _unique_room_code(self) -> str:
        while True:
            code = _generate_room_code()
            if not self.db.get(Room, code):
                return code

    @staticmethod
    def calculate_payouts(players: Sequence[Player]) -> GameResult:
        if not players:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No players to settle")
        if any(p.allocation_a is None or p.allocation_b is None for p in players):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing allocations")

        total_b = sum(int(p.allocation_b or 0) for p in players)
        boosted_pool = round(total_b * 1.5, 2)
        share = boosted_pool / len(players)

        payouts: list[PlayerPayout] = []
        for player in players:
            total = round((player.allocation_a or 0) + share, 2)
            payouts.append(
                PlayerPayout(
                    player_id=player.id,
                    display_name=player.display_name,
                    payout=total,
                )
            )

        return GameResult(total_b_pool=float(total_b), boosted_pool=boosted_pool, players=payouts)
