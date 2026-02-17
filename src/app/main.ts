import { SceneManager } from './scenes/SceneManager.ts';
import { TitleScene } from './scenes/TitleScene.ts';
import { GameScene } from './scenes/GameScene.ts';
import { ResultScene } from './scenes/ResultScene.ts';
import { JsSim } from '../sim/JsSim.ts';
import { Renderer } from '../render/Renderer.ts';
import { InputManager } from '../input/InputManager.ts';
import { HUD } from '../ui/HUD.ts';
import { stages } from '../levels/stages.ts';
import type { ReplayData } from '../sim/types.ts';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

const sceneManager = new SceneManager();
const sim = new JsSim();
const renderer = new Renderer(canvas);
const input = new InputManager(canvas);
const hud = new HUD();
let currentStage = 0;
let currentSeed = Date.now();

function startGame(): void {
  currentStage = 0;
  playStage();
}

function playStage(): void {
  currentSeed = Date.now();
  const level = stages[currentStage];
  const gameScene = new GameScene(
    sim,
    renderer,
    input,
    hud,
    level,
    currentSeed,
    onGameEnd,
  );
  sceneManager.changeScene(gameScene);
}

function onGameEnd(replay: ReplayData): void {
  const isLastStage = currentStage >= stages.length - 1;
  const onNext = replay.finalState === 'SUCCESS' && !isLastStage
    ? () => {
        currentStage++;
        playStage();
      }
    : undefined;

  const resultScene = new ResultScene(
    sim,
    renderer,
    replay,
    stages[currentStage],
    currentStage + 1,
    stages.length,
    () => { showTitle(); },
    onNext,
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
