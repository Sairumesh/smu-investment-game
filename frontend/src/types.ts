export interface Player {
  id: string;
  display_name: string;
  submitted: boolean;
  allocation_a: number | null;
  allocation_b: number | null;
  payout: number | null;
}

export interface Room {
  code: string;
  max_players: number;
  status: string;
  created_at: string;
}

export interface RoomDetail extends Room {
  players: Player[];
}

export interface RoomEventBase {
  room_code: string;
}

export interface PlayerEvent extends RoomEventBase {
  type: "player_joined" | "player_submitted";
  payload: {
    player: Player;
  };
}

export interface PlayerPayout {
  player_id: string;
  display_name: string;
  payout: number;
}

export interface GameResult {
  total_b_pool: number;
  boosted_pool: number;
  players: PlayerPayout[];
}

export interface ResultEvent extends RoomEventBase {
  type: "results_ready";
  payload: GameResult;
}

export interface PlayerLeftEvent extends RoomEventBase {
  type: "player_left";
  payload: {
    player_id: string;
    status: string;
  };
}

export type RoomEvent = PlayerEvent | ResultEvent | PlayerLeftEvent;
