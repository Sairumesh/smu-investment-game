import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  API_BASE_URL,
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom as leaveRoomApi,
  submitAllocation,
} from "./api";
import { useRoomEvents } from "./hooks/useRoomEvents";
import type { GameResult, Player, RoomDetail, RoomEvent } from "./types";

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const SESSION_KEY = "investment-game-session";

const clamp = (value: number) => Math.min(100, Math.max(0, value));

export default function App() {
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [result, setResult] = useState<GameResult | null>(null);
  const [allocation, setAllocation] = useState({ assetA: 50, assetB: 50 });
  const [createForm, setCreateForm] = useState({
    displayName: "",
    maxPlayers: 2,
  });
  const [joinForm, setJoinForm] = useState({ roomCode: "", displayName: "" });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshRoom = useCallback(async (code: string) => {
    const detail = await getRoom(code);
    setRoom(detail);
  }, []);

  const persistSession = (roomCode: string, playerId: string) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, playerId }));
  };

  const clearSession = () => {
    localStorage.removeItem(SESSION_KEY);
  };

  const handleCreateRoom = async (event: FormEvent) => {
    event.preventDefault();
    if (!createForm.displayName.trim()) {
      setError("Enter a display name to host a room");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const newRoom = await createRoom(createForm.maxPlayers);
      const joined = await joinRoom(
        newRoom.code,
        createForm.displayName.trim(),
      );
      await refreshRoom(newRoom.code);
      setPlayer(joined);
      persistSession(newRoom.code, joined.id);
      setStatus(`Room ${newRoom.code} created. Share the code with friends.`);
      setJoinForm((prev) => ({ ...prev, roomCode: newRoom.code }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create room");
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async (event: FormEvent) => {
    event.preventDefault();
    const name = joinForm.displayName.trim();
    const code = joinForm.roomCode.trim().toUpperCase();
    if (!name || !code) {
      setError("Enter both room code and display name");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const joined = await joinRoom(code, name);
      await refreshRoom(code);
      setPlayer(joined);
      persistSession(code, joined.id);
      setStatus(`Joined room ${code}. Waiting for everyone to submit.`);
      setResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to join room");
    } finally {
      setLoading(false);
    }
  };

  const handleAllocationChange = (value: number) => {
    const assetA = clamp(value);
    setAllocation({ assetA, assetB: 100 - assetA });
  };

  const handleSubmitAllocation = async (event: FormEvent) => {
    event.preventDefault();
    if (!room || !player) {
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const updated = await submitAllocation(
        room.code,
        player.id,
        allocation.assetA,
        allocation.assetB,
      );
      setPlayer(updated);
      await refreshRoom(room.code);
      setStatus("Submission received. Waiting for other players...");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveRoom = async () => {
    if (room && player && (!player.submitted || !result)) {
      try {
        await leaveRoomApi(room.code, player.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to leave right now");
        return;
      }
    }
    setRoom(null);
    setPlayer(null);
    setResult(null);
    setStatus(null);
    setError(null);
    setAllocation({ assetA: 50, assetB: 50 });
    setCreateForm({ displayName: "", maxPlayers: 2 });
    setJoinForm({ roomCode: "", displayName: "" });
    clearSession();
  };

  const handleRoomEvent = useCallback((event: RoomEvent) => {
    setRoom((current) => {
      if (!current || current.code !== event.room_code) {
        return current;
      }
      if (event.type === "results_ready") {
        setStatus(null);
        setResult(event.payload);
        const payoutMap = new Map(
          event.payload.players.map((entry) => [entry.player_id, entry]),
        );
        return {
          ...current,
          status: "completed",
          players: current.players.map((p) => {
            const payoutEntry = payoutMap.get(p.id);
            if (!payoutEntry) {
              return p;
            }
            return {
              ...p,
              submitted: true,
              payout: payoutEntry.payout,
            };
          }),
        };
      }

      if (event.type === "player_left") {
        return {
          ...current,
          status: event.payload.status ?? current.status,
          players: current.players.filter(
            (p) => p.id !== event.payload.player_id,
          ),
        };
      }

      const updatedPlayer = event.payload.player;
      const players = current.players.some((p) => p.id === updatedPlayer.id)
        ? current.players.map((p) =>
            p.id === updatedPlayer.id ? updatedPlayer : p,
          )
        : [...current.players, updatedPlayer];
      return { ...current, players };
    });

    if (event.type === "player_left") {
      let removedSelf = false;
      setPlayer((current) => {
        if (current && current.id === event.payload.player_id) {
          removedSelf = true;
          return null;
        }
        return current;
      });
      if (removedSelf) {
        clearSession();
      }
      return;
    }

    if (event.type === "results_ready") {
      setPlayer((current) => {
        if (!current) {
          return current;
        }
        const updated = event.payload.players.find(
          (entry) => entry.player_id === current.id,
        );
        if (!updated) {
          return current;
        }
        return { ...current, submitted: true, payout: updated.payout };
      });
    } else {
      setPlayer((current) => {
        if (!current || current.id !== event.payload.player.id) {
          return current;
        }
        return event.payload.player;
      });
    }
  }, []);

  useRoomEvents(room?.code ?? null, handleRoomEvent);

  useEffect(() => {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) {
      return;
    }
    try {
      const parsed = JSON.parse(saved) as { roomCode: string; playerId: string };
      if (!parsed.roomCode || !parsed.playerId) {
        return;
      }
      (async () => {
        try {
          const detail = await getRoom(parsed.roomCode);
          setRoom(detail);
          const existing = detail.players.find((p) => p.id === parsed.playerId);
          if (existing) {
            setPlayer(existing);
            setJoinForm((prev) => ({ ...prev, roomCode: parsed.roomCode }));
          } else {
            clearSession();
          }
        } catch {
          clearSession();
        }
      })();
    } catch {
      clearSession();
    }
  }, []);

  useEffect(() => {
    const handleUnload = () => {
      if (room && player && (!player.submitted || !result)) {
        fetch(`${API_BASE_URL}/rooms/${room.code}/players/${player.id}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => {
          // ignore
        });
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [room?.code, player?.id, player?.submitted, result]);

  const playersNeededText = useMemo(() => {
    if (!room) {
      return null;
    }
    return `${room.players.length}/${room.max_players} players joined`;
  }, [room]);

  const hasSubmitted = Boolean(player?.submitted);

  return (
    <>
      <div className="app-shell">
      <header>
        <h1>SMU Investment Game</h1>
        <p>
          Allocate $100 between Asset A and Asset B. Team up, pool capital, and
          see who cooperates.
        </p>
      </header>

      {error && <p className="error">{error}</p>}
      {status && !result && <p className="success">{status}</p>}

      {!room && (
        <div className="card-grid">
          <form className="card" onSubmit={handleCreateRoom}>
            <h2>Host a Room</h2>
            <label>
              Display Name
              <input
                value={createForm.displayName}
                onChange={(event) =>
                  setCreateForm({
                    ...createForm,
                    displayName: event.target.value,
                  })
                }
                placeholder="Enter your name"
              />
            </label>
            <label>
              Players (2-4)
              <select
                value={createForm.maxPlayers}
                onChange={(event) =>
                  setCreateForm({
                    ...createForm,
                    maxPlayers: Number(event.target.value),
                  })
                }
              >
                {Array.from(
                  { length: MAX_PLAYERS - MIN_PLAYERS + 1 },
                  (_, index) => index + MIN_PLAYERS,
                ).map((size) => (
                  <option key={size} value={size}>
                    {size} players
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions">
              <button type="submit" disabled={loading}>
                Create & Join
              </button>
            </div>
          </form>

          <form className="card" onSubmit={handleJoinRoom}>
            <h2>Join a Room</h2>
            <label>
              Room Code
              <input
                value={joinForm.roomCode}
                onChange={(event) =>
                  setJoinForm({
                    ...joinForm,
                    roomCode: event.target.value.toUpperCase(),
                  })
                }
                placeholder="ABC123"
              />
            </label>
            <label>
              Display Name
              <input
                value={joinForm.displayName}
                onChange={(event) =>
                  setJoinForm({ ...joinForm, displayName: event.target.value })
                }
                placeholder="Enter your name"
              />
            </label>
            <div className="form-actions">
              <button type="submit" disabled={loading}>
                Join Room
              </button>
            </div>
          </form>
        </div>
      )}

      {room && (
        <div className="card-grid" style={{ marginTop: "2rem" }}>
          <div className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h2>
                Room <span style={{ color: "#2563eb" }}>{room.code}</span>
              </h2>
              <span className="status-pill">{room.status}</span>
            </div>
            <p>{playersNeededText}</p>
            {!result && (
              <ul className="players-list">
                {room.players.map((p) => (
                  <li
                    key={p.id}
                    className="player-row"
                    style={
                      player?.id === p.id
                        ? { background: "#eff6ff", borderRadius: "0.5rem", padding: "0.75rem" }
                        : undefined
                    }
                  >
                    <div>
                        <strong>
                          {p.display_name}
                          {player?.id === p.id && (
                            <span style={{ marginLeft: "0.35rem", color: "#2563eb" }}>
                              (You)
                            </span>
                          )}
                        </strong>
                      <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                        {p.submitted ? "Submitted" : "Deciding"}
                      </div>
                    </div>
                    {player?.id === p.id && (
                      <span className="status-pill">You</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {result && (
              <div style={{ marginTop: "1.25rem" }}>
                <h3 style={{ marginBottom: "0.5rem" }}>Results</h3>
                <div className="result-grid">
                  <div>
                    <p>Total B Pool</p>
                    <div className="highlight">
                      ${result.total_b_pool.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <p>Boosted Pool (x1.5)</p>
                    <div className="highlight">
                      ${result.boosted_pool.toFixed(2)}
                    </div>
                  </div>
                </div>
                <ul className="players-list" style={{ marginTop: "1rem" }}>
                  {room.players.map((p) => {
                    const payout = result.players.find(
                      (entry) => entry.player_id === p.id,
                    );
                    return (
                    <li
                      key={p.id}
                      className="player-row"
                      style={
                        player?.id === p.id
                          ? {
                              background: "#eff6ff",
                              borderRadius: "0.5rem",
                              padding: "0.75rem",
                            }
                          : undefined
                      }
                    >
                        <div>
                        <strong>
                          {p.display_name}
                          {player?.id === p.id && (
                            <span style={{ marginLeft: "0.35rem", color: "#2563eb" }}>
                              (You)
                            </span>
                          )}
                        </strong>
                          <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                            A: ${p.allocation_a ?? 0} · B: ${p.allocation_b ?? 0}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div>${payout ? payout.payout.toFixed(2) : "--"}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="form-actions">
              <button type="button" onClick={() => void handleLeaveRoom()}>
                {result ? "Start Over" : "Leave Room"}
              </button>
            </div>
          </div>

          <form className="card" onSubmit={handleSubmitAllocation}>
            <h2>Your Allocation</h2>
            <p>
              Drag the slider or enter a value. Asset A returns to you, Asset B
              fuels the group boost.
            </p>
            <label>
              Asset A (${allocation.assetA})
              <input
                type="range"
                min={0}
                max={100}
                value={allocation.assetA}
                disabled={Boolean(result) || hasSubmitted}
                onChange={(event) =>
                  handleAllocationChange(Number(event.target.value))
                }
              />
            </label>
            <label>
              Asset B (${allocation.assetB})
              <input
                type="number"
                min={0}
                max={100}
                value={allocation.assetB}
                disabled={Boolean(result) || hasSubmitted}
                onChange={(event) => {
                  const nextB = clamp(Number(event.target.value));
                  handleAllocationChange(100 - nextB);
                }}
              />
            </label>
            {!result && (
              <div className="form-actions">
                <button type="submit" disabled={loading || hasSubmitted}>
                  {hasSubmitted ? "Submitted" : "Submit Allocation"}
                </button>
              </div>
            )}
            {result && (
              <p style={{ marginTop: "0.75rem", color: "#475569" }}>
                You invested ${player?.allocation_a ?? allocation.assetA} in
                Asset A and ${player?.allocation_b ?? allocation.assetB} in Asset
                B.
              </p>
            )}
          </form>

        </div>
      )}
      </div>
      <footer
        style={{ marginTop: "2rem", textAlign: "center", color: "#94a3b8" }}
      >
        Developed by Rumesh
      </footer>
    </>
  );
}
