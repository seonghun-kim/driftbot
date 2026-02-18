// SVG Sprite System — inline SVG → OffscreenCanvas pre-render cache

export interface SpriteEntry {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
}

export class SpriteSheet {
  private cache = new Map<string, SpriteEntry>();
  private pending = new Map<string, Promise<SpriteEntry>>();

  /** Register an SVG string, rasterize to OffscreenCanvas at given size. */
  register(key: string, svgStr: string, width: number, height: number): void {
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;

    const p = new Promise<SpriteEntry>((resolve) => {
      img.onload = () => {
        URL.revokeObjectURL(url);
        const oc = new OffscreenCanvas(width, height);
        const octx = oc.getContext('2d')!;
        octx.drawImage(img, 0, 0, width, height);
        const entry: SpriteEntry = { canvas: oc, width, height };
        this.cache.set(key, entry);
        resolve(entry);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        // Fallback: empty canvas so rendering doesn't break
        const oc = new OffscreenCanvas(width, height);
        const entry: SpriteEntry = { canvas: oc, width, height };
        this.cache.set(key, entry);
        resolve(entry);
      };
    });
    this.pending.set(key, p);
  }

  /** Get cached sprite. Falls back to 1×1 empty canvas if not yet loaded. */
  get(key: string): SpriteEntry {
    const entry = this.cache.get(key);
    if (entry) return entry;
    // Not yet loaded — return tiny fallback (will resolve next frame)
    return { canvas: new OffscreenCanvas(1, 1), width: 1, height: 1 };
  }

  /** Wait for all registered sprites to finish loading. */
  async ready(): Promise<void> {
    await Promise.all(this.pending.values());
  }
}

// ─── SVG Definitions ───────────────────────────────────────────

export const PLAYER_SPACE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="bodyS" cx="40%" cy="38%" r="55%">
      <stop offset="0%" stop-color="#a8e0f3"/>
      <stop offset="60%" stop-color="#7ec8e3"/>
      <stop offset="100%" stop-color="#3a7ca5"/>
    </radialGradient>
    <radialGradient id="glowS" cx="50%" cy="50%" r="50%">
      <stop offset="60%" stop-color="rgba(126,200,227,0)" />
      <stop offset="100%" stop-color="rgba(126,200,227,0.15)" />
    </radialGradient>
    <filter id="softS" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="1.2"/>
    </filter>
  </defs>
  <!-- Ambient glow -->
  <circle cx="32" cy="34" r="28" fill="url(#glowS)"/>
  <!-- Body -->
  <circle cx="32" cy="34" r="22" fill="url(#bodyS)" stroke="#a0d8ef" stroke-width="1.5"/>
  <!-- Highlight -->
  <ellipse cx="26" cy="27" rx="8" ry="5" fill="rgba(255,255,255,0.18)"/>
  <!-- Eyes -->
  <ellipse cx="25" cy="30" rx="4.5" ry="5" fill="#fff"/>
  <ellipse cx="39" cy="30" rx="4.5" ry="5" fill="#fff"/>
  <!-- Pupils -->
  <circle cx="26" cy="31" r="2.2" fill="#1a1a2e"/>
  <circle cx="40" cy="31" r="2.2" fill="#1a1a2e"/>
  <!-- Eye shine -->
  <circle cx="24" cy="29" r="1" fill="rgba(255,255,255,0.8)"/>
  <circle cx="38" cy="29" r="1" fill="rgba(255,255,255,0.8)"/>
  <!-- Antenna -->
  <line x1="32" y1="12" x2="32" y2="4" stroke="#a0d8ef" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="32" cy="3" r="2.5" fill="#ff6b6b"/>
  <circle cx="31.3" cy="2.3" r="0.8" fill="rgba(255,255,255,0.6)"/>
</svg>`;

export const PLAYER_WALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="bodyW" cx="40%" cy="38%" r="55%">
      <stop offset="0%" stop-color="#f5e0a0"/>
      <stop offset="60%" stop-color="#e3c87e"/>
      <stop offset="100%" stop-color="#a58c3a"/>
    </radialGradient>
    <radialGradient id="ringW" cx="50%" cy="50%" r="50%">
      <stop offset="70%" stop-color="rgba(255,220,100,0)" />
      <stop offset="100%" stop-color="rgba(255,220,100,0.3)" />
    </radialGradient>
    <filter id="softW" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="1.2"/>
    </filter>
  </defs>
  <!-- Glow ring -->
  <circle cx="32" cy="34" r="30" fill="url(#ringW)"/>
  <!-- Body -->
  <circle cx="32" cy="34" r="22" fill="url(#bodyW)" stroke="#efd8a0" stroke-width="1.5"/>
  <!-- Highlight -->
  <ellipse cx="26" cy="27" rx="8" ry="5" fill="rgba(255,255,255,0.2)"/>
  <!-- Eyes -->
  <ellipse cx="25" cy="30" rx="4.5" ry="5" fill="#fff"/>
  <ellipse cx="39" cy="30" rx="4.5" ry="5" fill="#fff"/>
  <!-- Pupils -->
  <circle cx="26" cy="31" r="2.2" fill="#1a1a2e"/>
  <circle cx="40" cy="31" r="2.2" fill="#1a1a2e"/>
  <!-- Eye shine -->
  <circle cx="24" cy="29" r="1" fill="rgba(255,255,255,0.8)"/>
  <circle cx="38" cy="29" r="1" fill="rgba(255,255,255,0.8)"/>
  <!-- Antenna -->
  <line x1="32" y1="12" x2="32" y2="4" stroke="#efd8a0" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="32" cy="3" r="2.5" fill="#ffb347"/>
  <circle cx="31.3" cy="2.3" r="0.8" fill="rgba(255,255,255,0.6)"/>
</svg>`;

export const DEBRIS_LARGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <radialGradient id="debL" cx="35%" cy="35%" r="60%">
      <stop offset="0%" stop-color="#e8c55a"/>
      <stop offset="50%" stop-color="#d4a843"/>
      <stop offset="100%" stop-color="#6b5020"/>
    </radialGradient>
  </defs>
  <!-- Irregular polygon meteorite -->
  <polygon points="16,2 26,6 30,14 28,24 20,30 8,28 2,20 4,10" fill="url(#debL)" stroke="rgba(255,200,100,0.4)" stroke-width="0.8"/>
  <!-- Crater details -->
  <ellipse cx="14" cy="14" rx="4" ry="3.5" fill="rgba(0,0,0,0.15)"/>
  <ellipse cx="22" cy="20" rx="3" ry="2.5" fill="rgba(0,0,0,0.12)"/>
  <ellipse cx="10" cy="22" rx="2" ry="1.5" fill="rgba(0,0,0,0.1)"/>
  <!-- Highlight -->
  <ellipse cx="12" cy="8" rx="4" ry="2.5" fill="rgba(255,255,255,0.15)"/>
</svg>`;

export const DEBRIS_SMALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
  <defs>
    <radialGradient id="debS" cx="35%" cy="35%" r="60%">
      <stop offset="0%" stop-color="#d8d070"/>
      <stop offset="50%" stop-color="#c8b860"/>
      <stop offset="100%" stop-color="#5a5a28"/>
    </radialGradient>
  </defs>
  <polygon points="10,1 17,4 19,11 15,18 7,19 2,13 3,5" fill="url(#debS)" stroke="rgba(220,220,120,0.4)" stroke-width="0.6"/>
  <ellipse cx="9" cy="9" rx="2.5" ry="2" fill="rgba(0,0,0,0.12)"/>
  <ellipse cx="8" cy="5" rx="2.5" ry="1.5" fill="rgba(255,255,255,0.12)"/>
</svg>`;

export const GOAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <defs>
    <radialGradient id="goalGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(100,255,150,0.4)"/>
      <stop offset="50%" stop-color="rgba(100,255,150,0.15)"/>
      <stop offset="100%" stop-color="rgba(100,255,150,0)"/>
    </radialGradient>
    <radialGradient id="goalCore" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(150,255,200,0.5)"/>
      <stop offset="70%" stop-color="rgba(100,255,150,0.3)"/>
      <stop offset="100%" stop-color="rgba(100,255,150,0.1)"/>
    </radialGradient>
  </defs>
  <!-- Outer glow -->
  <circle cx="48" cy="48" r="46" fill="url(#goalGlow)"/>
  <!-- Core circle -->
  <circle cx="48" cy="48" r="30" fill="url(#goalCore)" stroke="rgba(150,255,200,0.6)" stroke-width="1.5"/>
  <!-- Inner ring -->
  <circle cx="48" cy="48" r="20" fill="none" stroke="rgba(150,255,200,0.3)" stroke-width="1" stroke-dasharray="4 3"/>
  <!-- Down arrow -->
  <path d="M48,34 L48,58 M40,50 L48,60 L56,50" stroke="rgba(200,255,220,0.7)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

export const GATE_LOCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="lockBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ff9040"/>
      <stop offset="100%" stop-color="#cc5020"/>
    </linearGradient>
  </defs>
  <!-- Lock shackle -->
  <path d="M11,14 L11,10 Q11,5 16,5 Q21,5 21,10 L21,14" fill="none" stroke="#ff8030" stroke-width="2.5" stroke-linecap="round"/>
  <!-- Lock body -->
  <rect x="8" y="14" width="16" height="13" rx="2" fill="url(#lockBody)"/>
  <!-- Keyhole -->
  <circle cx="16" cy="19" r="2" fill="#1a1a2e"/>
  <rect x="15" y="20" width="2" height="4" rx="0.5" fill="#1a1a2e"/>
</svg>`;

export const AIRLOCK_RED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <defs>
    <radialGradient id="alR" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ff6060"/>
      <stop offset="60%" stop-color="#ff3030"/>
      <stop offset="100%" stop-color="#992020"/>
    </radialGradient>
  </defs>
  <circle cx="8" cy="8" r="6" fill="url(#alR)"/>
  <circle cx="6.5" cy="6.5" r="1.5" fill="rgba(255,255,255,0.3)"/>
</svg>`;

export const AIRLOCK_GREEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <defs>
    <radialGradient id="alG" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#80ff90"/>
      <stop offset="60%" stop-color="#50e060"/>
      <stop offset="100%" stop-color="#208030"/>
    </radialGradient>
  </defs>
  <circle cx="8" cy="8" r="6" fill="url(#alG)"/>
  <circle cx="6.5" cy="6.5" r="1.5" fill="rgba(255,255,255,0.3)"/>
</svg>`;

export const STAR_FAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
  <defs>
    <radialGradient id="sfG" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.9)"/>
      <stop offset="50%" stop-color="rgba(200,220,255,0.4)"/>
      <stop offset="100%" stop-color="rgba(200,220,255,0)"/>
    </radialGradient>
  </defs>
  <circle cx="4" cy="4" r="4" fill="url(#sfG)"/>
  <circle cx="4" cy="4" r="1" fill="#fff"/>
</svg>`;

export const STAR_NEAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <defs>
    <radialGradient id="snG" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.8)"/>
      <stop offset="40%" stop-color="rgba(200,230,255,0.3)"/>
      <stop offset="100%" stop-color="rgba(200,230,255,0)"/>
    </radialGradient>
  </defs>
  <!-- Cross-shaped star with glow -->
  <circle cx="8" cy="8" r="7" fill="url(#snG)"/>
  <!-- Cross spikes -->
  <line x1="8" y1="2" x2="8" y2="14" stroke="rgba(255,255,255,0.6)" stroke-width="1" stroke-linecap="round"/>
  <line x1="2" y1="8" x2="14" y2="8" stroke="rgba(255,255,255,0.6)" stroke-width="1" stroke-linecap="round"/>
  <!-- Diagonal spikes (smaller) -->
  <line x1="4" y1="4" x2="12" y2="12" stroke="rgba(255,255,255,0.25)" stroke-width="0.6" stroke-linecap="round"/>
  <line x1="12" y1="4" x2="4" y2="12" stroke="rgba(255,255,255,0.25)" stroke-width="0.6" stroke-linecap="round"/>
  <!-- Core -->
  <circle cx="8" cy="8" r="1.5" fill="#fff"/>
</svg>`;

export const NEBULA_PURPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <radialGradient id="nebP1" cx="45%" cy="42%" r="55%">
      <stop offset="0%" stop-color="rgba(80,30,120,0.12)"/>
      <stop offset="50%" stop-color="rgba(60,20,100,0.06)"/>
      <stop offset="100%" stop-color="rgba(40,10,80,0)"/>
    </radialGradient>
    <radialGradient id="nebP2" cx="60%" cy="55%" r="40%">
      <stop offset="0%" stop-color="rgba(100,40,140,0.08)"/>
      <stop offset="100%" stop-color="rgba(60,20,100,0)"/>
    </radialGradient>
    <filter id="nebBlur" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="12"/>
    </filter>
  </defs>
  <ellipse cx="115" cy="108" rx="110" ry="95" fill="url(#nebP1)" filter="url(#nebBlur)"/>
  <ellipse cx="150" cy="145" rx="80" ry="70" fill="url(#nebP2)" filter="url(#nebBlur)"/>
</svg>`;

export const NEBULA_BLUE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <radialGradient id="nebB1" cx="50%" cy="48%" r="55%">
      <stop offset="0%" stop-color="rgba(30,60,120,0.12)"/>
      <stop offset="50%" stop-color="rgba(20,40,100,0.06)"/>
      <stop offset="100%" stop-color="rgba(10,25,80,0)"/>
    </radialGradient>
    <radialGradient id="nebB2" cx="40%" cy="58%" r="40%">
      <stop offset="0%" stop-color="rgba(40,80,150,0.08)"/>
      <stop offset="100%" stop-color="rgba(20,50,110,0)"/>
    </radialGradient>
    <filter id="nebBlurB" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="12"/>
    </filter>
  </defs>
  <ellipse cx="130" cy="120" rx="105" ry="100" fill="url(#nebB1)" filter="url(#nebBlurB)"/>
  <ellipse cx="110" cy="150" rx="75" ry="65" fill="url(#nebB2)" filter="url(#nebBlurB)"/>
</svg>`;

export const FINISH_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="flagPole" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#c0c0c0"/>
      <stop offset="100%" stop-color="#808080"/>
    </linearGradient>
    <linearGradient id="flagBody" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#60ff90"/>
      <stop offset="100%" stop-color="#30c060"/>
    </linearGradient>
  </defs>
  <!-- Pole -->
  <line x1="14" y1="6" x2="14" y2="42" stroke="url(#flagPole)" stroke-width="2.5" stroke-linecap="round"/>
  <!-- Flag -->
  <path d="M14,8 L36,14 L14,22 Z" fill="url(#flagBody)" stroke="rgba(100,255,150,0.5)" stroke-width="0.8"/>
  <!-- Checkered pattern on flag -->
  <rect x="16" y="11" width="4" height="3" fill="rgba(255,255,255,0.25)"/>
  <rect x="24" y="11" width="4" height="3" fill="rgba(255,255,255,0.25)"/>
  <rect x="20" y="14" width="4" height="3" fill="rgba(255,255,255,0.25)"/>
  <!-- Base -->
  <ellipse cx="14" cy="42" rx="5" ry="2" fill="rgba(150,150,150,0.4)"/>
</svg>`;
