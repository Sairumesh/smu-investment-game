import type { Player, Room, RoomDetail } from "./types";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const text = await response.text();
      if (text) {
        try {
          const data = JSON.parse(text);
          if (typeof data === "string") {
            message = data;
          } else if (data?.detail) {
            message = data.detail;
          } else {
            message = text;
          }
        } catch {
          message = text;
        }
      }
    } catch {
      // ignore parsing errors, fall back to status text
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

export async function createRoom(maxPlayers: number): Promise<Room> {
  return request<Room>("/rooms", {
    method: "POST",
    body: JSON.stringify({ max_players: maxPlayers }),
  });
}

export async function getRoom(code: string): Promise<RoomDetail> {
  return request<RoomDetail>(`/rooms/${code}`);
}

export async function joinRoom(code: string, displayName: string): Promise<Player> {
  return request<Player>(`/rooms/${code}/join`, {
    method: "POST",
    body: JSON.stringify({ display_name: displayName }),
  });
}

export async function submitAllocation(
  code: string,
  playerId: string,
  assetA: number,
  assetB: number,
): Promise<Player> {
  return request<Player>(`/rooms/${code}/submit`, {
    method: "POST",
    body: JSON.stringify({ player_id: playerId, asset_a: assetA, asset_b: assetB }),
  });
}

export async function leaveRoom(code: string, playerId: string): Promise<void> {
  await request<void>(`/rooms/${code}/players/${playerId}`, {
    method: "DELETE",
  });
}
