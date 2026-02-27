from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import AsyncIterator, Dict, Set


class RoomEventBroker:
    """In-memory broker that multiplexes SSE streams per room."""

    def __init__(self) -> None:
        self._subscribers: Dict[str, Set[asyncio.Queue[str]]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def publish(self, room_code: str, event: dict) -> None:
        message = json.dumps(event)
        async with self._lock:
            queues = list(self._subscribers.get(room_code, set()))
        for queue in queues:
            await queue.put(message)

    async def subscribe(self, room_code: str) -> AsyncIterator[str]:
        queue: asyncio.Queue[str] = asyncio.Queue()
        async with self._lock:
            self._subscribers[room_code].add(queue)
        try:
            while True:
                payload = await queue.get()
                yield payload
        finally:
            async with self._lock:
                subscribers = self._subscribers.get(room_code)
                if subscribers and queue in subscribers:
                    subscribers.remove(queue)
                if subscribers == set():
                    self._subscribers.pop(room_code, None)


broker = RoomEventBroker()
