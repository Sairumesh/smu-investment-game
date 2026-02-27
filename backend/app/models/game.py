from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Room(Base):
    __tablename__ = "rooms"
    __table_args__ = (
        CheckConstraint("max_players >= 2 AND max_players <= 4", name="room_player_bounds"),
    )

    code: Mapped[str] = mapped_column(String(8), primary_key=True, index=True)
    max_players: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    status: Mapped[str] = mapped_column(String(32), default="waiting", nullable=False)

    players: Mapped[list["Player"]] = relationship(
        back_populates="room", cascade="all, delete-orphan", order_by="Player.joined_at"
    )


class Player(Base):
    __tablename__ = "players"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_code: Mapped[str] = mapped_column(String(8), ForeignKey("rooms.code", ondelete="CASCADE"))
    display_name: Mapped[str] = mapped_column(String(64))
    allocation_a: Mapped[int | None] = mapped_column(Integer)
    allocation_b: Mapped[int | None] = mapped_column(Integer)
    payout: Mapped[float | None] = mapped_column(Numeric(10, 2))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    room: Mapped[Room] = relationship(back_populates="players")

    __table_args__ = (
        CheckConstraint("allocation_a + allocation_b = 100", name="allocation_total",),
    )
