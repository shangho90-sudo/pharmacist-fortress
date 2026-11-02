import type { CharTypeId } from '../core/characters';
import type { Game, GameOptions, InputState } from '../core/game';
import type { MapId } from '../core/mapgen';

export const PROTOCOL = 1;
export type BattleAction = { kind: 'input'; move: InputState['move']; aim: InputState['aim'] }
  | { kind: 'fire'; weapon: 'basic' | 'special' | 'ultimate' | 'move'; power: number }
  | { kind: 'skip' };
export type Command = { player: number; turn: number; action: BattleAction } | { forfeit: number };
export interface Member { id: string; name: string; character: CharTypeId | null; team: 'blue' | 'red'; ready: boolean }
export interface Lobby { id: string; title: string; host: string; mode: 'ffa' | 'teams'; map: MapId; members: Member[]; playing: boolean; max: number }
export interface StartMatch { type: 'start'; match: string; options: GameOptions; seats: string[]; mode: Lobby['mode'] }
export interface Frame { type: 'frame'; match: string; from: number; steps: Command[][] }
export type ServerMessage = { type: 'hello'; id: string; token: string; version: number }
  | { type: 'rooms'; rooms: Lobby[] } | { type: 'room'; room: Lobby }
  | { type: 'left'; reason: string } | { type: 'error'; message: string }
  | StartMatch | Frame | { type: 'pong' };

/** Shared command application: only the server validates and emits these. */
export function applyCommand(g: Game, c: Command) {
  if ('forfeit' in c) { g.forfeit(c.forfeit); return; }
  if (g.current !== c.player || g.turnNumber !== c.turn || !g.canControl) return;
  const a = c.action;
  if (a.kind === 'input') g.setInput({ move: a.move, aim: a.aim });
  else if (a.kind === 'fire') g.fire(a.weapon, a.power);
  else g.skipTurn();
}
