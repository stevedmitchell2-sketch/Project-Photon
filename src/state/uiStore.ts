import { create } from 'zustand';
import { defaultMatchSettings, type MatchSettings } from '@/config/gameModes';
import type { TeamId } from '@/config/teams';

export type Screen = 'main_menu' | 'lobby' | 'settings' | 'loading' | 'playing' | 'paused' | 'results';

export interface HudSnapshot {
  health: number;
  shield: number;
  charge: number;
  chargeMax: number;
  recharging: boolean;
  rechargeProgress: number;
  alive: boolean;
  respawnIn: number;
  spread: number;
  adsBlend: number;
  team: TeamId;
  score: number;
  kills: number;
  deaths: number;
  assists: number;
  timeRemaining: number;
  scores: Array<{ key: string; label: string; team: TeamId; score: number }>;
  fps: number;
  simMs: number;
  drawCalls: number;
  /** Central objective room: who holds it, and whether it is being fought over. */
  objective: {
    label: string;
    controllingTeam: TeamId | null;
    contested: boolean;
    occupants: number;
    heldSeconds: number;
  };
}

export interface DamageIndicator {
  id: number;
  yaw: number;
  time: number;
}

interface UiState {
  screen: Screen;
  matchSettings: MatchSettings;
  loadingMessage: string;
  loadingProgress: number;
  hud: HudSnapshot;
  hitMarker: { time: number; killed: boolean } | null;
  damageIndicators: DamageIndicator[];
  killFeed: Array<{ id: number; killer: string; killerTeam: TeamId; victim: string; victimTeam: TeamId; headshot: boolean; selfInflicted: boolean }>;
  subtitle: string | null;
  notifications: Array<{ id: number; text: string; tone: 'info' | 'good' | 'bad'; time: number }>;
  scoreboardOpen: boolean;
  scoreboard: Array<{ id: number; name: string; team: TeamId; kills: number; deaths: number; assists: number; score: number; isLocal: boolean; isBot: boolean }>;
  matchResult: { winner: TeamId | null; scores: Array<{ team: TeamId; score: number }> } | null;

  setScreen(screen: Screen): void;
  setMatchSettings(patch: Partial<MatchSettings>): void;
  setLoading(message: string, progress: number): void;
  setHud(hud: Partial<HudSnapshot>): void;
  pushHitMarker(killed: boolean, time: number): void;
  pushDamageIndicator(yaw: number, time: number): void;
  setKillFeed(feed: UiState['killFeed']): void;
  setSubtitle(text: string | null): void;
  pushNotification(text: string, tone: 'info' | 'good' | 'bad'): void;
  setScoreboardOpen(open: boolean): void;
  setScoreboard(rows: UiState['scoreboard']): void;
  setMatchResult(result: UiState['matchResult']): void;
}

const emptyHud = (): HudSnapshot => ({
  health: 100,
  shield: 60,
  charge: 6,
  chargeMax: 6,
  recharging: false,
  rechargeProgress: 1,
  alive: true,
  respawnIn: 0,
  spread: 0,
  adsBlend: 0,
  team: 'red',
  score: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
  timeRemaining: 0,
  scores: [],
  fps: 0,
  simMs: 0,
  drawCalls: 0,
  objective: { label: 'CENTRAL ROOM', controllingTeam: null, contested: false, occupants: 0, heldSeconds: 0 },
});

/**
 * UI-facing mirror of the simulation.
 *
 * The sim never writes here directly on its own cadence — the presentation bridge samples it once
 * per rendered frame and pushes a snapshot. That keeps React re-renders decoupled from the 64 Hz
 * tick, which is the difference between a HUD that costs 0.1 ms and one that costs 3 ms.
 */
export const useUi = create<UiState>()((set) => ({
  screen: 'main_menu',
  matchSettings: defaultMatchSettings(),
  loadingMessage: '',
  loadingProgress: 0,
  hud: emptyHud(),
  hitMarker: null,
  damageIndicators: [],
  killFeed: [],
  subtitle: null,
  notifications: [],
  scoreboardOpen: false,
  scoreboard: [],
  matchResult: null,

  setScreen: (screen) => set({ screen }),
  setMatchSettings: (patch) => set((s) => ({ matchSettings: { ...s.matchSettings, ...patch } })),
  setLoading: (loadingMessage, loadingProgress) => set({ loadingMessage, loadingProgress }),
  setHud: (hud) => set((s) => ({ hud: { ...s.hud, ...hud } })),
  pushHitMarker: (killed, time) => set({ hitMarker: { time, killed } }),
  pushDamageIndicator: (yaw, time) =>
    set((s) => ({
      damageIndicators: [...s.damageIndicators.slice(-5), { id: time * 1000, yaw, time }],
    })),
  setKillFeed: (killFeed) => set({ killFeed }),
  setSubtitle: (subtitle) => set({ subtitle }),
  pushNotification: (text, tone) =>
    set((s) => ({
      // Bounded stack, newest last. The HUD ages them out; this only stops unbounded growth.
      notifications: [
        ...s.notifications.slice(-4),
        { id: performance.now(), text, tone, time: performance.now() / 1000 },
      ],
    })),
  setScoreboardOpen: (scoreboardOpen) => set({ scoreboardOpen }),
  setScoreboard: (scoreboard) => set({ scoreboard }),
  setMatchResult: (matchResult) => set({ matchResult }),
}));
