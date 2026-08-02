import type { TeamId } from './teams';

export type GameModeId =
  | 'team_deathmatch'
  | 'free_for_all'
  | 'capture_the_flag'
  | 'king_of_the_hill'
  | 'domination'
  | 'elimination'
  | 'last_team_standing'
  | 'training'
  | 'bot_practice';

export type ScoringEvent = 'elimination' | 'capture' | 'hold_tick' | 'objective';

export interface GameModeConfig {
  id: GameModeId;
  name: string;
  description: string;
  /** Teams participating. FFA uses one "team" per player, assigned round-robin from this list. */
  teamCount: 2 | 3 | 4;
  freeForAll: boolean;
  scoreLimit: number;
  timeLimitSeconds: number;
  respawnSeconds: number;
  /** Elimination-style modes set this to false. */
  respawnEnabled: boolean;
  friendlyFire: boolean;
  maxPlayersPerTeam: number;
  points: Partial<Record<ScoringEvent, number>>;
  /** Which arena features the mode needs — the builder validates the arena provides them. */
  requires: ReadonlyArray<'flag' | 'hill' | 'capture_points'>;
  /** Implemented in milestone 1? Modes not yet wired are shown but disabled in the lobby. */
  implemented: boolean;
}

export const GAME_MODES: Record<GameModeId, GameModeConfig> = {
  team_deathmatch: {
    id: 'team_deathmatch',
    name: 'Team Deathmatch',
    description: 'Tag the other teams. First to the score limit wins.',
    teamCount: 2,
    freeForAll: false,
    scoreLimit: 50,
    timeLimitSeconds: 600,
    respawnSeconds: 5,
    respawnEnabled: true,
    friendlyFire: false,
    maxPlayersPerTeam: 6,
    points: { elimination: 1 },
    requires: [],
    implemented: true,
  },
  free_for_all: {
    id: 'free_for_all',
    name: 'Free For All',
    description: 'Everyone for themselves. Highest score when the clock runs out.',
    teamCount: 4,
    freeForAll: true,
    scoreLimit: 25,
    timeLimitSeconds: 480,
    respawnSeconds: 4,
    respawnEnabled: true,
    friendlyFire: true,
    maxPlayersPerTeam: 1,
    points: { elimination: 1 },
    requires: [],
    implemented: true,
  },
  bot_practice: {
    id: 'bot_practice',
    name: 'Bot Practice',
    description: 'Team deathmatch against bots only, with relaxed respawn timers.',
    teamCount: 2,
    freeForAll: false,
    scoreLimit: 30,
    timeLimitSeconds: 900,
    respawnSeconds: 3,
    respawnEnabled: true,
    friendlyFire: false,
    maxPlayersPerTeam: 6,
    points: { elimination: 1 },
    requires: [],
    implemented: true,
  },
  capture_the_flag: {
    id: 'capture_the_flag',
    name: 'Capture the Flag',
    description: 'Carry the enemy beacon back to your base.',
    teamCount: 2,
    freeForAll: false,
    scoreLimit: 3,
    timeLimitSeconds: 900,
    respawnSeconds: 8,
    respawnEnabled: true,
    friendlyFire: false,
    maxPlayersPerTeam: 6,
    points: { capture: 1, elimination: 0 },
    requires: ['flag'],
    implemented: true,
  },
  king_of_the_hill: {
    id: 'king_of_the_hill',
    name: 'King of the Hill',
    description: 'Hold the moving objective room to bank time.',
    teamCount: 2,
    freeForAll: false,
    scoreLimit: 120,
    timeLimitSeconds: 600,
    respawnSeconds: 6,
    respawnEnabled: true,
    friendlyFire: false,
    maxPlayersPerTeam: 6,
    points: { hold_tick: 1 },
    requires: ['hill'],
    implemented: true,
  },
  domination: {
    id: 'domination',
    name: 'Domination',
    description: 'Capture and hold three control nodes.',
    teamCount: 2,
    freeForAll: false,
    scoreLimit: 200,
    timeLimitSeconds: 900,
    respawnSeconds: 6,
    respawnEnabled: true,
    friendlyFire: false,
    maxPlayersPerTeam: 6,
    points: { hold_tick: 1, capture: 5 },
    requires: ['capture_points'],
    implemented: true,
  },
  elimination: {
    id: 'elimination',
    name: 'Elimination',
    description: 'One life per round. Last team standing takes it.',
    teamCount: 2,
    freeForAll: false,
    scoreLimit: 6,
    timeLimitSeconds: 180,
    respawnSeconds: 0,
    respawnEnabled: false,
    friendlyFire: true,
    maxPlayersPerTeam: 6,
    points: { objective: 1 },
    requires: [],
    implemented: true,
  },
  last_team_standing: {
    id: 'last_team_standing',
    name: 'Last Team Standing',
    description: 'One life each. The last team with anyone left takes the round.',
    teamCount: 2,
    freeForAll: false,
    scoreLimit: 5,
    timeLimitSeconds: 240,
    respawnSeconds: 0,
    respawnEnabled: false,
    friendlyFire: true,
    maxPlayersPerTeam: 8,
    points: { objective: 1 },
    requires: [],
    implemented: true,
  },
  training: {
    id: 'training',
    name: 'Training',
    description: 'Empty arena with movement and accuracy drills.',
    teamCount: 2,
    freeForAll: false,
    scoreLimit: 0,
    timeLimitSeconds: 0,
    respawnSeconds: 1,
    respawnEnabled: true,
    friendlyFire: false,
    maxPlayersPerTeam: 1,
    points: {},
    requires: [],
    implemented: true,
  },
};

/** Runtime match settings — what the lobby actually hands to the MatchDirector. */
export interface MatchSettings {
  mode: GameModeId;
  arena: string;
  teams: TeamId[];
  scoreLimit: number;
  timeLimitSeconds: number;
  respawnSeconds: number;
  friendlyFire: boolean;
  botsEnabled: boolean;
  botsPerTeam: number;
  botDifficulty: 'easy' | 'medium' | 'hard' | 'expert';
  playerTeam: TeamId;
  seed: number;
}

export const defaultMatchSettings = (): MatchSettings => {
  const mode = GAME_MODES.team_deathmatch;
  return {
    mode: mode.id,
    arena: 'arena02_apex',
    teams: ['red', 'blue'],
    scoreLimit: mode.scoreLimit,
    timeLimitSeconds: mode.timeLimitSeconds,
    respawnSeconds: mode.respawnSeconds,
    friendlyFire: mode.friendlyFire,
    botsEnabled: true,
    botsPerTeam: 3,
    botDifficulty: 'medium',
    playerTeam: 'red',
    seed: 1337,
  };
};
