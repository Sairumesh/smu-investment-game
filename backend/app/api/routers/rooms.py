from __future__ import annotations

import asyncio
from decimal import Decimal
from typing import AsyncIterator

from fastapi import APIRouter, Depends, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.game import (
    GameResult,
    PlayerCreate,
    PlayerRead,
    RoomCreate,
    RoomDetail,
    RoomEvent,
    RoomRead,
    SubmitAllocation,
)
from app.services.events import broker
from app.services.game_service import GameService

router = APIRouter(prefix="/rooms", tags=["rooms"])


def _serialize_player(player) -> PlayerRead:
    payout = player.payout
    payout_value: float | None
    if payout is None:
        payout_value = None
    else:
        payout_value = float(payout)

    return PlayerRead(
        id=player.id,
        display_name=player.display_name,
        submitted=bool(player.submitted_at),
        allocation_a=player.allocation_a,
        allocation_b=player.allocation_b,
        payout=payout_value,
    )


@router.post("", response_model=RoomRead, status_code=status.HTTP_201_CREATED)
async def create_room(payload: RoomCreate, db: Session = Depends(get_db)):
    service = GameService(db)
    room = await run_in_threadpool(service.create_room, payload)
    return RoomRead.model_validate(room)


@router.get("/{code}", response_model=RoomDetail)
async def room_detail(code: str, db: Session = Depends(get_db)):
    service = GameService(db)
    room = await run_in_threadpool(service.get_room, code)
    players = await run_in_threadpool(service.list_players, code)
    return RoomDetail(
        **RoomRead.model_validate(room).model_dump(),
        players=[_serialize_player(p) for p in players],
    )


@router.post("/{code}/join", response_model=PlayerRead)
async def join_room(code: str, payload: PlayerCreate, db: Session = Depends(get_db)):
    service = GameService(db)
    player = await run_in_threadpool(service.join_room, code, payload.display_name)
    player_data = _serialize_player(player)
    event = RoomEvent(
        type="player_joined",
        room_code=code,
        payload={"player": player_data.model_dump()},
    )
    await broker.publish(code, event.model_dump())
    return player_data


@router.post("/{code}/submit", response_model=PlayerRead)
async def submit_allocation(code: str, payload: SubmitAllocation, db: Session = Depends(get_db)):
    service = GameService(db)
    player, result = await run_in_threadpool(
        service.submit_allocation, code, payload.player_id, payload.asset_a, payload.asset_b
    )
    player_data = _serialize_player(player)
    submission_event = RoomEvent(
        type="player_submitted",
        room_code=code,
        payload={"player": player_data.model_dump()},
    )
    await broker.publish(code, submission_event.model_dump())

    if isinstance(result, GameResult):
        result_event = RoomEvent(
            type="results_ready",
            room_code=code,
            payload=result.model_dump(),
        )
        await broker.publish(code, result_event.model_dump())

    return player_data


@router.delete("/{code}/players/{player_id}", status_code=status.HTTP_204_NO_CONTENT)
async def leave_room(code: str, player_id: str, db: Session = Depends(get_db)):
    service = GameService(db)
    player, room = await run_in_threadpool(service.leave_room, code, player_id)
    event = RoomEvent(
        type="player_left",
        room_code=code,
        payload={"player_id": player.id, "status": room.status},
    )
    await broker.publish(code, event.model_dump())
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{code}/events")
async def room_events(code: str):
    async def event_stream() -> AsyncIterator[str]:
        async for message in broker.subscribe(code):
            yield f"data: {message}\n\n"
            await asyncio.sleep(0)

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=headers)
