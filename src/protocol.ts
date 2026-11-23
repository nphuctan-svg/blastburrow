import type { Critter, Gadget } from './content.js';
import type { Input, Settings, State } from './engine.js';
import type { Profile } from './profile.js';

export interface Member {
  id: string;
  name: string;
  critter: Critter;
  gadget: Gadget;
  ready: boolean;
  connected: boolean;
}
export interface Lobby {
  code: string;
  host: string;
  members: Member[];
  settings: Settings;
  seats: number;
  phase: 'lobby' | 'match' | 'result';
  resume: boolean;
  nextMission?: { missionId: string; waitingForParty: boolean };
}
export type ClientMessage =
  | { type: 'enter'; code?: string; token: string; name: string; settings?: Settings }
  | { type: 'setup'; settings: Settings; seats: number }
  | { type: 'loadout'; critter: Critter; gadget: Gadget }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' | 'retry' | 'lobby' | 'leave' }
  | ({ type: 'input'; seq: number } & Input)
  | { type: 'ping'; time: number };
export type ServerMessage =
  | { type: 'entered'; id: string }
  | { type: 'lobby'; lobby: Lobby }
  | { type: 'frame'; state: State; ack: number; matchId: string }
  | { type: 'profile'; profile: Profile }
  | { type: 'pong'; time: number }
  | { type: 'error'; message: string; fatal?: boolean };
