export interface Scene {
  enter(): void;
  exit(): void;
  update(): void;
  draw(): void;
}

export class SceneManager {
  private current: Scene | null = null;

  changeScene(next: Scene): void {
    if (this.current) {
      this.current.exit();
    }
    this.current = next;
    this.current.enter();
  }

  update(): void {
    this.current?.update();
  }

  draw(): void {
    this.current?.draw();
  }
}
