import { createContext, useContext } from 'react';
import type { Game } from '@/engine/Game';

const GameContext = createContext<Game | null>(null);

export const GameProvider = GameContext.Provider;

/** Access the live Game instance. Renderers use this to read simulation state each frame. */
export function useGame(): Game {
  const game = useContext(GameContext);
  if (!game) throw new Error('useGame called outside a GameProvider');
  return game;
}
