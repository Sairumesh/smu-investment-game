import { useEffect } from "react";

import { API_BASE_URL } from "../api";
import type { RoomEvent } from "../types";

export function useRoomEvents(
  roomCode: string | null,
  onEvent: (event: RoomEvent) => void,
): void {
  useEffect(() => {
    if (!roomCode) {
      return;
    }

    const source = new EventSource(`${API_BASE_URL}/rooms/${roomCode}/events`);

    source.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data) as RoomEvent;
        onEvent(payload);
      } catch (error) {
        console.error("Failed to parse event", error);
      }
    };

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, [roomCode, onEvent]);
}
