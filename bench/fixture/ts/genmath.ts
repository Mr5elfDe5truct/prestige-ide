// Sizes, frame counts and time estimates for image, video and song generation (from Prestige's src/gensettings.ts).

export type Aspect = "1:1" | "4:3" | "3:4" | "3:2" | "2:3" | "16:9" | "9:16";
export type ImgSize = "small" | "standard" | "large";

const AREA: Record<ImgSize, number> = { small: 768 * 768, standard: 1024 * 1024, large: 1328 * 1328 };

export const SVI_FPS = 24;
export const SVI_OVERLAP = 5;
export const sviSeconds = (frames: number, shots: number) => Math.round(((frames * shots - SVI_OVERLAP * (shots - 1)) / SVI_FPS) * 10) / 10;

/** Width and height for an image setting, multiples of 16. */
export function imageDims(aspect: Aspect, size: ImgSize): [number, number] {
  const [a, b] = aspect.split(":").map(Number);
  const w = Math.sqrt((AREA[size] * a) / b);
  const r16 = (x: number) => Math.max(256, Math.round(x / 16) * 16);
  return [r16(w), r16((w * b) / a)];
}

export const parseRes = (r: string): [number, number] => {
  const [w, h] = r.split("x").map(Number);
  return [w || 768, h || 512];
};

/** Wan's size for "Match the picture": landscape, portrait or square from the source image's shape. */
export function wanAuto(srcW?: number | null, srcH?: number | null): [number, number] {
  const r = srcW && srcH ? srcW / srcH : 16 / 9;
  return r > 1.2 ? [832, 480] : r < 0.83 ? [480, 832] : [640, 640];
}

/** LTX frame counts are 8n + 1. */
export const ltxFrames = (seconds: number, fps: number) => Math.max(1, Math.round((seconds * fps) / 8)) * 8 + 1;
/** Wan renders at 16 fps and needs 4n + 1 frames. */
export const wanFrames = (seconds: number) => Math.max(1, Math.round((seconds * 16) / 4)) * 4 + 1;

/** "about 40 s", "about 2.5 min". */
export function aboutTime(secs: number) {
  if (secs < 55) return `about ${Math.max(5, Math.round(secs / 5) * 5)} s`;
  const min = secs / 60;
  return `about ${min < 10 ? Math.round(min * 2) / 2 : Math.round(min)} min`;
}
