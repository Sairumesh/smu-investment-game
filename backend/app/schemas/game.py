from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class RoomCreate(BaseModel):
    max_players: int = Field(ge=2, le=4)


class RoomRead(BaseModel):
    code: str
    max_players: int
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class PlayerCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=64)


class PlayerRead(BaseModel):
    id: str
    display_name: str
    submitted: bool
    allocation_a: int | None = None
    allocation_b: int | None = None
    payout: float | None = None


class RoomDetail(RoomRead):
    players: list[PlayerRead]


class SubmitAllocation(BaseModel):
    player_id: str
    asset_a: int = Field(ge=0, le=100)
    asset_b: int = Field(ge=0, le=100)


class PlayerPayout(BaseModel):
    player_id: str
    display_name: str
    payout: float


class GameResult(BaseModel):
    total_b_pool: float
    boosted_pool: float
    players: list[PlayerPayout]


class RoomEvent(BaseModel):
    type: Literal[
        "player_joined",
        "player_submitted",
        "player_left",
        "results_ready",
    ]
    room_code: str
    payload: dict
