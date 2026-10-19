export type Key =
  | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'ENT' | 'CLR' | 'MENU'
  | 'CH16' | 'DIAL' | 'DISTRESS' | 'PTT' | 'HILO'
  | 'SOFT1' | 'SOFT2' | 'SOFT3' | 'SOFT4'
  | 'MICUP' | 'MICDOWN' | 'CW' | 'CCW';

export interface Row { label: string; value?: string; dim?: boolean }

export interface MainView {
  kind: 'main';
  busy: boolean; tx: boolean; power: string; group: string;
  gps: 'ok' | 'blink' | 'off'; mail: 'off' | 'on' | 'blink'; autoSw: boolean;
  mode: 'STBY' | 'RT';
  channel: string; name: string; fav: boolean; call: boolean; dup: boolean;
  scan: string; watch: string;
  pos: string[]; soft: string[];
  overlay?: { label: string; value: number; max: number };
  toast?: string; closeup?: string;
}

export type LcdView =
  | { kind: 'off' }
  | MainView
  | { kind: 'list'; title: string; rows: Row[]; sel: number; soft: string[]; hint?: string }
  | { kind: 'text'; title?: string; lines: string[]; soft: string[]; big?: boolean; alert?: boolean }
  | { kind: 'entry'; title: string; text: string; cursor: number; keys: string[]; keySel: number; soft: string[] };

export interface Screen {
  view(): LcdView;
  key(k: Key): void;
  tick?(dt: number): void;
  /** PTT soll auf diesem Bildschirm funktionieren (z.B. Notruf-Bildschirme) */
  pttOk?: boolean;
}

export interface Station { name: string; mmsi: string }

export interface Pos { lat: string; lon: string } // z.B. "54°11.20'N", "007°54.00'E"

export interface CallRecord {
  time: string; type: string; peer: string; ch?: number; cat?: string; nature?: string; read?: boolean;
}

export const SOFT_FUNCS = ['DISTRESS', 'OTHER DSC', 'SCAN', 'DW/TW', 'CHAN', 'HI/LO', 'AQUA', 'FAV', 'NAME', 'BKLT', 'LOG'] as const;
