import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from '@/engine/Game';
import { GameCanvas } from '@/render/GameCanvas';
import { useSettings } from '@/state/settingsStore';
import { useUi } from '@/state/uiStore';
import { Hud } from '@/ui/hud/Hud';
import { Lobby } from '@/ui/menus/Lobby';
import { MainMenu } from '@/ui/menus/MainMenu';
import { LoadingScreen, PauseMenu, ResultsScreen, Scoreboard } from '@/ui/menus/Overlays';
import { SettingsMenu } from '@/ui/menus/SettingsMenu';

/**
 * Application shell.
 *
 * Owns the Game lifecycle and nothing else. React drives screens and the HUD; the Game owns the
 * simulation loop. The only coupling between them is the UI store snapshot the engine pushes and
 * the lifecycle calls made here.
 */
export function App() {
  const screen = useUi((s) => s.screen);
  const setScreen = useUi((s) => s.setScreen);
  const setLoading = useUi((s) => s.setLoading);
  const scoreboardOpen = useUi((s) => s.scoreboardOpen);
  const matchSettings = useUi((s) => s.matchSettings);

  const settings = useSettings();
  const [game, setGame] = useState<Game | null>(null);
  const gameRef = useRef<Game | null>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [settingsFromPause, setSettingsFromPause] = useState(false);

  // Keep the live engine in sync with settings changes made while playing.
  useEffect(() => {
    gameRef.current?.updateSettings(
      settings.input,
      settings.accessibility.reduceCameraShake,
      settings.accessibility.reduceViewBob,
    );
  }, [settings.input, settings.accessibility.reduceCameraShake, settings.accessibility.reduceViewBob]);

  useEffect(() => {
    gameRef.current?.audio.setMix(settings.audio);
  }, [settings.audio]);

  const pause = useCallback(() => {
    const current = gameRef.current;
    if (!current) return;
    current.input.exitPointerLock();
    setScreen('paused');
  }, [setScreen]);

  const startMatch = useCallback(async () => {
    // Tear down any previous match before building a new one.
    gameRef.current?.dispose();
    gameRef.current = null;
    setGame(null);

    setScreen('loading');
    setLoading('Initialising', 0);

    const next = new Game({ onPause: () => pause() });
    try {
      await next.load(
        matchSettings,
        useSettings.getState().input,
        useSettings.getState().playerName,
        (message, progress) => setLoading(message, progress),
      );
    } catch (error) {
      console.error('Failed to start match', error);
      setLoading(error instanceof Error ? error.message : 'Failed to load', 0);
      next.dispose();
      return;
    }

    gameRef.current = next;
    setGame(next);
    next.start();
    setScreen('playing');
  }, [matchSettings, pause, setLoading, setScreen]);

  // Attach input and lock the pointer once the canvas host exists and play begins.
  useEffect(() => {
    if (screen !== 'playing' || !game || !canvasHostRef.current) return;
    const host = canvasHostRef.current;
    game.attachInput(host);

    const onClick = () => {
      // Audio must start from a user gesture; the click that locks the pointer is the natural one.
      if (!game.audio.isStarted) {
        game.audio.start();
        game.audio.setMix(useSettings.getState().audio);
      } else {
        game.audio.resume();
      }
      game.input.requestPointerLock(host);
    };
    host.addEventListener('click', onClick);

    // Losing the pointer lock without pressing Escape (alt-tab, window blur) should also pause.
    game.input.onPointerLockChange = (locked) => {
      if (!locked && useUi.getState().screen === 'playing') pause();
    };

    return () => {
      host.removeEventListener('click', onClick);
      game.input.onPointerLockChange = null;
      game.input.detach();
    };
  }, [screen, game, pause]);

  const quitMatch = useCallback(() => {
    gameRef.current?.dispose();
    gameRef.current = null;
    setGame(null);
    useUi.getState().setMatchResult(null);
    setScreen('main_menu');
  }, [setScreen]);

  useEffect(() => () => gameRef.current?.dispose(), []);

  const showCanvas = game !== null && screen !== 'main_menu' && screen !== 'lobby';

  return (
    <div className="photon-root">
      {showCanvas && (
        <div ref={canvasHostRef} className="photon-canvas">
          <GameCanvas game={game} />
        </div>
      )}

      {screen === 'playing' && game && <Hud game={game} />}
      {screen === 'playing' && scoreboardOpen && <Scoreboard />}

      {screen === 'main_menu' && <MainMenu />}
      {screen === 'lobby' && <Lobby onStart={() => void startMatch()} />}
      {screen === 'loading' && <LoadingScreen />}

      {screen === 'paused' && (
        <PauseMenu
          onResume={() => {
            setScreen('playing');
            if (canvasHostRef.current) game?.input.requestPointerLock(canvasHostRef.current);
          }}
          onSettings={() => {
            setSettingsFromPause(true);
            setScreen('settings');
          }}
          onQuit={quitMatch}
        />
      )}

      {screen === 'settings' && (
        <SettingsMenu
          onClose={() => {
            setScreen(settingsFromPause ? 'paused' : 'main_menu');
            setSettingsFromPause(false);
          }}
        />
      )}

      {screen === 'results' && (
        <ResultsScreen onRematch={() => void startMatch()} onExit={quitMatch} />
      )}
    </div>
  );
}
