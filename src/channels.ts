/** Kanalplan (INT-Gruppe, vereinfacht) */
export const CHANNELS: number[] = [
  ...Array.from({ length: 28 }, (_, i) => i + 1),
  ...Array.from({ length: 29 }, (_, i) => i + 60),
];

/** Simplex-Kanäle (Schiff-Schiff); alle anderen sind Duplex-Kanäle */
export const SIMPLEX = new Set([6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77]);

/** Kanäle, auf denen nur mit niedriger Leistung (1 W) gesendet wird */
export const LOW_ONLY = new Set([15, 17, 75, 76]);

export const DEFAULT_NAMES: Record<number, string> = {
  6: 'SAFETY',
  9: 'CALLING',
  13: 'BRIDGE',
  16: 'DISTRESS',
  70: 'DSC',
};

export const pad2 = (n: number): string => String(n).padStart(2, '0');
