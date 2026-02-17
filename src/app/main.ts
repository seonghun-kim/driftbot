import { SceneManager } from './scenes/SceneManager.ts';
import { TitleScene } from './scenes/TitleScene.ts';
import { GameScene } from './scenes/GameScene.ts';
import { ResultScene } from './scenes/ResultScene.ts';
import { JsSim } from '../sim/JsSim.ts';
import { Renderer } from '../render/Renderer.ts';
import { InputManager } from '../input/InputManager.ts';
import { HUD } from '../ui/HUD.ts';
import { level01 } from '../levels/level01.ts';
import type { ReplayData } from '../sim/types.ts';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

const sceneManager = new SceneManager();
const sim = new JsSim();
const renderer = new Renderer(canvas);
const input = new InputManager(canvas);
const hud = new HUD();

let currentSeed = Date.now();

function startGame(): void {
  currentSeed = Date.now();
  const gameScene = new GameScene(
    sim,
    renderer,
    input,
    hud,
    level01,
    currentSeed,
    onGameEnd,
  );
  sceneManager.changeScene(gameScene);
}

function onGameEnd(replay: ReplayData): void {
  const resultScene = new ResultScene(
    sim,
    renderer,
    replay,
    level01,
    () => {
      showTitle();
    },
  );
  sceneManager.changeScene(resultScene);
}

function showTitle(): void {
  const titleScene = new TitleScene(renderer, startGame);
  sceneManager.changeScene(titleScene);
}

window.addEventListener('resize', () => {
  renderer.resize();
});

showTitle();
