export const BACKGROUND_TOKENS = {
  dotGrid: {
    spacing: 26,
    baseRadius: 1.2,
    baseAlpha: 0.16,
    hoverAlpha: 0.38,
    hoverRadiusBoost: 1.4,
    influence: 140,
    maxRepel: 5,
    pointerEase: 0.18,
    activeEase: 0.08,
    maxDpr: 2,
    targetFps: 60,
  },
  mouseGlow: {
    size: 560,
    blur: 85,
    baseOpacity: 0.04,
    reducedOpacity: 0.03,
    ease: 0.16,
    inactiveOpacity: 0,
    maxDpr: 2,
  },
} as const