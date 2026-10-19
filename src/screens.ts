import type { Key, LcdView, Row, Screen } from './types';
import type { Radio } from './radio';

const VISIBLE_ROWS = 4;

/** Auswahlliste (Menü, Optionen); EXIT = SOFT1, BACK = SOFT2 */
export class ListScreen implements Screen {
  sel: number;
  constructor(
    private r: Radio,
    private title: string,
    private rows: () => Row[],
    private onSelect: (i: number) => void,
    private opts: { sel?: number; soft4?: string; onSoft4?: () => void; onBack?: () => void; hint?: string } = {},
  ) {
    this.sel = opts.sel ?? 0;
  }

  view(): LcdView {
    const rows = this.rows();
    const top = Math.max(0, Math.min(this.sel - 1, rows.length - VISIBLE_ROWS));
    return {
      kind: 'list', title: this.title, rows: rows.slice(top, top + VISIBLE_ROWS), sel: this.sel - top,
      soft: ['EXIT', 'BACK', '', this.opts.soft4 ?? ''], hint: this.opts.hint,
    };
  }

  key(k: Key): void {
    const n = this.rows().length;
    switch (k) {
      case 'UP': case 'CCW': this.sel = (this.sel + n - 1) % n; break;
      case 'DOWN': case 'CW': this.sel = (this.sel + 1) % n; break;
      case 'ENT': this.onSelect(this.sel); break;
      case 'CLR': case 'SOFT2': this.back(); break;
      case 'MENU': case 'SOFT1': this.r.popToMain(); break;
      case 'SOFT4': this.opts.onSoft4?.(); break;
    }
  }

  private back(): void { if (this.opts.onBack) this.opts.onBack(); else this.r.pop(); }
}

/** Auswahl einer Option; setzt den Wert und kehrt zurück */
export function optionScreen<T extends string>(
  r: Radio, title: string, options: readonly T[], current: T, set: (v: T) => void,
): ListScreen {
  return new ListScreen(
    r, title,
    () => options.map((o) => ({ label: o === current ? `● ${o}` : `○ ${o}` })),
    (i) => { set(options[i]); r.pop(); },
    { sel: Math.max(0, options.indexOf(current)) },
  );
}

/** Reiner Textbildschirm mit Softtasten */
export class TextScreen implements Screen {
  pttOk = false;
  constructor(
    private r: Radio,
    private body: () => { title?: string; lines: string[]; big?: boolean; alert?: boolean },
    private soft: () => string[],
    private onKey: (k: Key) => boolean | void = () => false,
  ) {}
  view(): LcdView { return { kind: 'text', ...this.body(), soft: this.soft() }; }
  key(k: Key): void {
    if (this.onKey(k)) return;
    if (k === 'CLR' || k === 'SOFT2') this.r.pop();
    else if (k === 'MENU' || k === 'SOFT1') this.r.popToMain();
  }
}

export type Slot = { t: 'd' } | { t: 'lit'; c: string } | { t: 'c'; opts: string[] };

/** Zifferneingabe (MMSI, Position, ...): ◄/► wählen Zeichen, ENT übernimmt, DIAL bewegt den Cursor */
export class EntryScreen implements Screen {
  private vals: string[];
  private pos: number;
  private keySel = 0;
  constructor(
    private r: Radio,
    private title: string,
    private slots: Slot[],
    private onDone: (value: string) => void,
    initial?: string,
  ) {
    this.vals = slots.map((s, i) => (s.t === 'lit' ? s.c : initial?.[i] ?? (s.t === 'd' ? '0' : s.opts[0])));
    this.pos = this.nextEditable(-1);
  }

  private nextEditable(from: number): number {
    for (let i = from + 1; i < this.slots.length; i++) if (this.slots[i].t !== 'lit') return i;
    return from < 0 ? 0 : this.pos;
  }
  private prevEditable(from: number): number {
    for (let i = from - 1; i >= 0; i--) if (this.slots[i].t !== 'lit') return i;
    return this.pos;
  }
  private keys(): string[] {
    const s = this.slots[this.pos];
    return s.t === 'c' ? [...s.opts, '←', '→'] : ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '←', '→'];
  }
  value(): string { return this.vals.join(''); }

  view(): LcdView {
    return {
      kind: 'entry', title: this.title, text: this.value(), cursor: this.pos,
      keys: this.keys(), keySel: this.keySel, soft: ['EXIT', 'BACK', '', 'FIN'],
    };
  }

  key(k: Key): void {
    const keys = this.keys();
    switch (k) {
      case 'LEFT': this.keySel = (this.keySel + keys.length - 1) % keys.length; break;
      case 'RIGHT': this.keySel = (this.keySel + 1) % keys.length; break;
      case 'CW': this.pos = this.nextEditable(this.pos); this.keySel = 0; break;
      case 'CCW': this.pos = this.prevEditable(this.pos); this.keySel = 0; break;
      case 'UP': case 'DOWN': break;
      case 'ENT': {
        const c = keys[this.keySel];
        if (c === '←') this.pos = this.prevEditable(this.pos);
        else if (c === '→') this.pos = this.nextEditable(this.pos);
        else { this.vals[this.pos] = c; this.pos = this.nextEditable(this.pos); }
        this.keySel = 0;
        break;
      }
      case 'CLR': case 'SOFT2': this.r.pop(); break;
      case 'MENU': case 'SOFT1': this.r.popToMain(); break;
      case 'SOFT4': this.onDone(this.value()); break;
    }
  }
}

/** Texteingabe (Kanalname) */
export class NameScreen implements Screen {
  private static CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/';
  private chars: string[];
  private pos = 0;
  constructor(private r: Radio, private title: string, initial: string, private onDone: (v: string) => void) {
    this.chars = initial.padEnd(10, ' ').slice(0, 10).split('');
  }
  view(): LcdView {
    return {
      kind: 'entry', title: this.title, text: this.chars.join(''), cursor: this.pos,
      keys: ['▲▼ / DIAL: Zeichen', '◄ ►: Cursor'], keySel: -1, soft: ['EXIT', 'BACK', '', 'ENT'],
    };
  }
  key(k: Key): void {
    const C = NameScreen.CHARS;
    const step = (d: number) => { this.chars[this.pos] = C[(C.indexOf(this.chars[this.pos]) + d + C.length) % C.length]; };
    switch (k) {
      case 'UP': case 'CW': step(1); break;
      case 'DOWN': case 'CCW': step(-1); break;
      case 'LEFT': this.pos = Math.max(0, this.pos - 1); break;
      case 'RIGHT': this.pos = Math.min(this.chars.length - 1, this.pos + 1); break;
      case 'ENT': case 'SOFT4': this.onDone(this.chars.join('').trimEnd()); break;
      case 'CLR': case 'SOFT2': this.r.pop(); break;
      case 'MENU': case 'SOFT1': this.r.popToMain(); break;
    }
  }
}

/** Kanalauswahl für DSC-Rufe ("Intership CH") */
export class ChannelPickScreen implements Screen {
  private idx: number;
  constructor(private r: Radio, private chans: number[], current: number, private onDone: (ch: number) => void) {
    this.idx = Math.max(0, chans.indexOf(current));
  }
  view(): LcdView {
    return { kind: 'text', title: 'CHANNEL', lines: ['Intership CH:', String(this.chans[this.idx]).padStart(2, '0')], big: true, soft: ['EXIT', 'BACK', '', 'ENT'] };
  }
  key(k: Key): void {
    const n = this.chans.length;
    switch (k) {
      case 'UP': case 'CW': this.idx = (this.idx + 1) % n; break;
      case 'DOWN': case 'CCW': this.idx = (this.idx + n - 1) % n; break;
      case 'ENT': case 'SOFT4': this.onDone(this.chans[this.idx]); break;
      case 'CLR': case 'SOFT2': this.r.pop(); break;
      case 'MENU': case 'SOFT1': this.r.popToMain(); break;
    }
  }
}
