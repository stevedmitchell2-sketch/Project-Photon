export type TeamId = 'red' | 'blue' | 'green' | 'yellow';
export const TEAM_IDS: readonly TeamId[] = ['red', 'blue', 'green', 'yellow'] as const;

export interface TeamDefinition {
  id: TeamId;
  name: string;
  /** Base armour/trim colour, linear-ish sRGB hex. */
  color: number;
  /** Emissive colour for bolts and trim. Deliberately brighter than `color` so bloom reads. */
  emissive: number;
  /** Colourblind-safe alternate, used when the accessibility palette is enabled. */
  colorblindColor: number;
  colorblindEmissive: number;
  /** Distinct shape stamped on the HUD and player back-plate — readability without relying on hue. */
  glyph: '▲' | '■' | '●' | '◆';
  /** Corner of the arena this team spawns from, as a normalized bias in map space. */
  spawnCorner: readonly [number, number];
}

export const TEAMS: Record<TeamId, TeamDefinition> = {
  red: {
    id: 'red',
    name: 'Red',
    color: 0xff2d55,
    emissive: 0xff5c78,
    colorblindColor: 0xff6d1f,
    colorblindEmissive: 0xffa04a,
    glyph: '▲',
    spawnCorner: [-1, -1],
  },
  blue: {
    id: 'blue',
    name: 'Blue',
    color: 0x2d7bff,
    emissive: 0x5ca8ff,
    colorblindColor: 0x2f9bff,
    colorblindEmissive: 0x77c8ff,
    glyph: '■',
    spawnCorner: [1, 1],
  },
  green: {
    id: 'green',
    name: 'Green',
    color: 0x2dff87,
    emissive: 0x6cffb0,
    colorblindColor: 0xffffff,
    colorblindEmissive: 0xdff4ff,
    glyph: '●',
    spawnCorner: [-1, 1],
  },
  yellow: {
    id: 'yellow',
    name: 'Yellow',
    color: 0xffd42d,
    emissive: 0xffe97a,
    colorblindColor: 0xc46bff,
    colorblindEmissive: 0xdda4ff,
    glyph: '◆',
    spawnCorner: [1, -1],
  },
};

export const teamColor = (team: TeamId, colorblind: boolean): number =>
  colorblind ? TEAMS[team].colorblindColor : TEAMS[team].color;

export const teamEmissive = (team: TeamId, colorblind: boolean): number =>
  colorblind ? TEAMS[team].colorblindEmissive : TEAMS[team].emissive;

export const teamCss = (team: TeamId, colorblind: boolean): string =>
  `#${teamColor(team, colorblind).toString(16).padStart(6, '0')}`;

export const teamEmissiveCss = (team: TeamId, colorblind: boolean): string =>
  `#${teamEmissive(team, colorblind).toString(16).padStart(6, '0')}`;
