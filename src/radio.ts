import { CHANNELS, DEFAULT_NAMES, LOW_ONLY, SIMPLEX, pad2 } from './channels';
import { SOFT_FUNCS } from './types';
import type { CallRecord, Key, LcdView, MainView, Screen, Station } from './types';
import { EntryScreen, ListScreen, NameScreen } from './screens';
import { buildMenu, backlightScreen } from './menu';
import { beginDistressHold, distressScreen, otherDscScreen } from './dsc';

export interface Settings {
  volume: number; squelch: number; keyBeep: boolean; backlight: number; contrast: number;
  utcOffset: number; inactivity: string; gpsOn: boolean;
  scanType: 'Normal' | 'Priority'; scanTimer: string; watchMode: 'Dual Watch' | 'Tri Watch';
  group: 'INT' | 'ATIS'; callChannel: number; favs: number[]; favOnMic: boolean;
  chDisplay: 'Number' | 'Number+Name'; chCloseup: boolean;
  autoAck: 'Auto' | 'Manual'; chAutoSw: string; dataOutput: string; alarm: boolean; ch70Sql: number;
  individual: Station[]; groups: Station[]; names: Record<number, string>; hiddenKeys: string[];
}

export interface Sim {
  signals: Map<number, number>;           // Kanal -> Feldstärke 1..9
  gps: boolean;
  stationReply: 'able' | 'unable' | 'none';
  coastAck: boolean;
  coastAckDelayMs: number;
}

export interface RadioEvent { t: number; type: string; [k: string]: unknown }
export type Sound = 'beep' | 'alarm' | 'dsc' | 'aqua' | 'error' | 'longbeep';

export const NOISE_LEVEL = 3;
export const GPS_POS = { lat: "54°11.20'N".replace("'", ''), lon: '007°54.00E' };

export const defaultSettings = (): Settings => ({
  volume: 12, squelch: 4, keyBeep: true, backlight: 5, contrast: 4, utcOffset: 1, inactivity: '5 min', gpsOn: true,
  scanType: 'Normal', scanTimer: '5 sec', watchMode: 'Dual Watch', group: 'INT', callChannel: 9, favs: [], favOnMic: false,
  chDisplay: 'Number', chCloseup: true, autoAck: 'Manual', chAutoSw: 'Accept after 10 sec.', dataOutput: 'On', alarm: true, ch70Sql: 4,
  individual: [
    { name: 'STATION 1', mmsi: '211111110' }, { name: 'STATION 2', mmsi: '211222220' }, { name: 'STATION 3', mmsi: '211333330' },
  ],
  groups: [{ name: 'GROUP 1', mmsi: '021100001' }],
  names: { ...DEFAULT_NAMES }, hiddenKeys: [],
});

type SoftFunc = (typeof SOFT_FUNCS)[number];
const DSC_FUNCS: SoftFunc[] = ['DISTRESS', 'OTHER DSC'];
const HOLD_MS = { DIAL: 1000, CH16: 1000, DISTRESS: 3000 } as Record<string, number>;

interface Timer { at: number; fn: () => void; id: number }

export class Radio {
  on = false;
  time = 0;
  settings: Settings = defaultSettings();
  mmsi: string | null = '211000001';
  atis: string | null = '9211000001';
  channel = 16;
  prevChannel = 16;
  special: null | '16' | 'call' = '16';
  hiPower = true;
  tx = false;
  mode: 'STBY' | 'RT' = 'STBY';
  scan: null | 'normal' | 'priority' = null;
  scanCh = 1;
  watch: null | 'DW' | 'TW' = null;
  coverOpen = false;
  distressNature = 'Undesignated';
  distressActive = false;
  mail: 'off' | 'on' | 'blink' = 'off';
  manualPos: { lat: string; lon: string; utc: string; at: number } | null = null;
  rxLog: CallRecord[] = [];
  txLog: CallRecord[] = [];
  sim: Sim = { signals: new Map(), gps: true, stationReply: 'able', coastAck: true, coastAckDelayMs: 6000 };
  events: RadioEvent[] = [];
  listeners: ((e: RadioEvent) => void)[] = [];
  sound: (s: Sound) => void = () => {};
  utcNow: () => Date = () => new Date();

  stack: Screen[] = [];
  main = new MainScreen(this);
  private timers: Timer[] = [];
  private timerId = 0;
  private held = new Map<string, { at: number; fired: boolean }>();
  private txStart = 0;
  lastAct = 0;

  constructor() { this.stack = [this.main]; }

  // ---------- Infrastruktur ----------
  get top(): Screen { return this.stack[this.stack.length - 1]; }
  push(s: Screen): void { this.stack.push(s); }
  pop(): void { if (this.stack.length > 1) this.stack.pop(); }
  popToMain(): void { this.stack.length = 1; }
  replace(s: Screen): void { this.stack[this.stack.length - 1] = s; }

  emit(type: string, data: Record<string, unknown> = {}): void {
    const e: RadioEvent = { t: this.time, type, ...data };
    this.events.push(e);
    this.listeners.forEach((l) => l(e));
  }
  schedule(ms: number, fn: () => void): number {
    const id = ++this.timerId;
    this.timers.push({ at: this.time + ms, fn, id });
    return id;
  }
  cancel(id: number): void { this.timers = this.timers.filter((t) => t.id !== id); }
  beep(): void { if (this.settings.keyBeep) this.sound('beep'); }
  toast(text: string): void { this.main.toast = { text, ttl: 2000 }; }

  // ---------- Hilfsgrößen ----------
  chName(ch: number): string { return this.settings.names[ch] ?? ''; }
  isDuplex(ch: number): boolean { return !SIMPLEX.has(ch); }
  get channels(): number[] { return CHANNELS; }
  squelchOpen(ch: number): boolean {
    const s = this.sim.signals.get(ch);
    return this.settings.squelch < NOISE_LEVEL || (s !== undefined && this.settings.squelch < s);
  }
  signalOn(ch: number): boolean {
    const s = this.sim.signals.get(ch);
    return s !== undefined && this.settings.squelch < s;
  }
  /** Kanal, auf dem aktuell gehört wird (Scan/Watch berücksichtigt) */
  rxChannel(): number {
    if (this.scan) return this.scanCh;
    if (this.watch) {
      if (this.channel !== 16 && this.signalOn(16)) return 16;
      if (this.watch === 'TW' && this.channel !== this.settings.callChannel && !this.signalOn(this.channel) && this.signalOn(this.settings.callChannel))
        return this.settings.callChannel;
    }
    return this.channel;
  }
  get busy(): boolean { return this.on && !this.tx && this.squelchOpen(this.rxChannel()); }
  get power(): 'HI' | 'LO' { return this.hiPower && !LOW_ONLY.has(this.rxChannel()) ? 'HI' : 'LO'; }
  /** Rauschen/Signal hörbar: für die Audio-Engine */
  audio(): { noise: boolean; signal: boolean; volume: number } {
    const ch = this.rxChannel();
    const sig = this.signalOn(ch) && this.on && !this.tx;
    return { noise: this.on && !this.tx && !sig && this.settings.squelch < NOISE_LEVEL, signal: sig, volume: this.on ? this.settings.volume / 30 : 0 };
  }
  localTime(): string {
    const u = this.utcNow();
    const d = new Date(u.getTime() + this.settings.utcOffset * 3600000);
    return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  }
  position(): { lat: string; lon: string; time: string; source: 'gps' | 'manual' } | null {
    if (this.sim.gps && this.settings.gpsOn) return { ...GPS_POS, time: this.localTime(), source: 'gps' };
    const m = this.manualPos;
    if (m && this.time - m.at < 23.5 * 3600000) {
      const mins = (parseInt(m.utc.slice(0, 2), 10) * 60 + parseInt(m.utc.slice(2, 4), 10) + Math.floor((this.time - m.at) / 60000) + this.settings.utcOffset * 60) % 1440;
      return { lat: m.lat, lon: m.lon, time: `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`, source: 'manual' };
    }
    return null;
  }
  nowStamp(): string { return `${this.utcNow().toISOString().slice(0, 10)} ${this.localTime()}`; }

  // ---------- Bedienung ----------
  down(k: Key): void {
    if (!this.on && k !== 'DIAL') return;
    this.lastAct = this.time;
    if (HOLD_MS[k]) {
      this.held.set(k, { at: this.time, fired: false });
      if (k === 'DISTRESS') beginDistressHold(this);
      return;
    }
    if (k === 'PTT') { this.startTx(); return; }
    this.key(k);
  }
  up(k: Key): void {
    if (k === 'PTT') { this.stopTx(); return; }
    const h = this.held.get(k);
    if (!h) return;
    this.held.delete(k);
    if (k === 'DISTRESS') { this.emit('distress-release'); return; }
    if (!h.fired) this.key(k);
  }
  press(k: Key): void { this.down(k); this.up(k); }
  setCover(open: boolean): void { this.coverOpen = open; this.emit('cover', { open }); }
  rotate(dir: 1 | -1): void { if (this.on) { this.lastAct = this.time; this.key(dir === 1 ? 'CW' : 'CCW'); } }
  cancelHold(k: Key): void { this.held.delete(k); }
  isHeld(k: Key): boolean { return this.held.has(k); }
  heldMs(k: Key): number { const h = this.held.get(k); return h ? this.time - h.at : 0; }

  key(k: Key): void {
    if (!this.on) { if (k === 'DIAL') return; return; }
    if (k !== 'CW' && k !== 'CCW') this.beep();
    this.top.key(k === 'MICUP' && this.top !== this.main ? 'UP' : k === 'MICDOWN' && this.top !== this.main ? 'DOWN' : k);
  }

  private startTx(): void {
    if (!this.on) return;
    if (this.channel === 70 && !this.scan) { this.sound('error'); this.toast('No TX on CH 70'); return; }
    this.tx = true; this.mode = 'RT'; this.txStart = this.time; this.scan = null;
    this.emit('ptt-start', { channel: this.channel, power: this.power, noise: this.settings.squelch < NOISE_LEVEL, volume: this.settings.volume });
  }
  private stopTx(): void {
    if (!this.tx) return;
    this.tx = false;
    this.emit('ptt-end', { channel: this.channel, ms: this.time - this.txStart });
  }

  setChannel(ch: number, special: Radio['special'] = null): void {
    if (this.special === null && ch !== this.channel) this.prevChannel = this.channel;
    this.channel = ch; this.special = special;
    this.scan = null;
    if (this.settings.chCloseup) this.main.closeup = { text: `${pad2(ch)} ${this.chName(ch)}`, ttl: 1500 };
    this.emit('channel', { ch, special });
  }

  powerToggle(): void {
    if (this.on) {
      this.on = false; this.tx = false; this.scan = null; this.watch = null; this.popToMain(); this.timers = [];
      this.emit('power', { on: false });
    } else {
      this.on = true; this.time += 0; this.mode = 'STBY'; this.lastAct = this.time;
      this.sound('beep');
      this.push(new BootScreen(this));
      this.emit('power', { on: true });
    }
  }

  // ---------- Zeitsteuerung ----------
  tick(dt: number): void {
    this.time += dt;
    for (const t of [...this.timers]) if (t.at <= this.time) { this.timers = this.timers.filter((x) => x !== t); t.fn(); }
    for (const [k, h] of this.held) {
      if (!h.fired && this.time - h.at >= HOLD_MS[k]) {
        h.fired = true;
        if (k === 'DIAL') { this.powerToggle(); this.held.delete(k); }
        else if (k === 'CH16') { this.setChannel(this.settings.callChannel, 'call'); this.beep(); }
      }
    }
    if (!this.on) return;
    if (this.tx && this.time - this.txStart > 300000) { this.stopTx(); this.sound('error'); this.toast('TX timeout'); }
    this.main.tick(dt);
    this.top.tick?.(dt);
  }

  // ---------- Persistenz ----------
  snapshot(): string {
    return JSON.stringify({ settings: this.settings, mmsi: this.mmsi, atis: this.atis });
  }
  restore(json: string): void {
    try {
      const o = JSON.parse(json);
      this.settings = { ...defaultSettings(), ...o.settings };
      this.mmsi = o.mmsi ?? null; this.atis = o.atis ?? null;
    } catch { /* ignorieren */ }
  }
  factoryReset(): void {
    this.settings = defaultSettings(); this.mmsi = null; this.atis = null;
    this.on = false; this.popToMain(); this.scan = null; this.watch = null; this.tx = false;
    this.channel = 16; this.special = '16'; this.mail = 'off'; this.rxLog = []; this.txLog = []; this.manualPos = null;
    this.emit('factory-reset');
  }
}

class BootScreen implements Screen {
  private t = 0;
  constructor(private r: Radio) {}
  view(): LcdView { return { kind: 'text', lines: ['ICOM', 'IC-M330GE', 'MARINE VHF'], big: true, soft: ['', '', '', ''] }; }
  key(): void {}
  tick(dt: number): void {
    this.t += dt;
    if (this.t > 1500) {
      this.r.pop();
      if (!this.r.mmsi) this.r.push(mmsiPrompt(this.r));
    }
  }
}

function mmsiPrompt(r: Radio): Screen {
  const entry = (title: string, done: (v: string) => void) =>
    new EntryScreen(r, title, Array.from({ length: 9 }, () => ({ t: 'd' as const })), done);
  return {
    view: () => ({ kind: 'text', title: 'MMSI', lines: ['Push [ENT] to', 'Register your MMSI'], soft: ['', '', '', ''] }),
    key: (k) => {
      if (k === 'CLR') { r.pop(); return; } // (Handbuch: 2x CLR überspringt die Eingabe)
      if (k !== 'ENT') return;
      r.replace(entry('MMSI Input', (v) => {
        r.replace(entry('Confirmation', (v2) => {
          if (v2 !== v) { r.popToMain(); r.toast('Not matched'); return; }
          r.mmsi = v; r.popToMain(); r.toast('MMSI registered'); r.emit('mmsi-registered');
        }));
      }));
    },
  };
}

// ---------- Hauptbildschirm ----------
export class MainScreen implements Screen {
  softPage = 0;
  overlay: { kind: 'vol' | 'sql'; ttl: number } | null = null;
  toast: { text: string; ttl: number } | null = null;
  closeup: { text: string; ttl: number } | null = null;
  private scanAcc = 0;
  private scanHold = 0;
  private scanIdx = 0;
  constructor(private r: Radio) {}

  private funcs(): SoftFunc[] {
    const { r } = this;
    return SOFT_FUNCS.filter((f) => !r.settings.hiddenKeys.includes(f) && (r.mmsi || !DSC_FUNCS.includes(f)));
  }
  private page(): SoftFunc[] {
    const f = this.funcs();
    const pages = Math.max(1, Math.ceil(f.length / 4));
    this.softPage = ((this.softPage % pages) + pages) % pages;
    return f.slice(this.softPage * 4, this.softPage * 4 + 4);
  }
  private label(f: SoftFunc): string {
    const { r } = this;
    switch (f) {
      case 'DW/TW': return r.settings.watchMode === 'Dual Watch' ? 'DW' : 'TW';
      case 'FAV': return r.settings.favs.includes(r.channel) ? '★ OFF' : '★';
      case 'SCAN': return r.scan ? 'SCAN ■' : 'SCAN';
      default: return f;
    }
  }

  view(): LcdView {
    const { r } = this;
    const ch = r.rxChannel();
    const pos = r.position();
    const pv = pos
      ? [pos.lat.replace(/\.\d\d/, ''), pos.lon.replace(/\.\d\d/, ''), pos.time]
      : ['NO POS', 'NO TIME'];
    const v: MainView = {
      kind: 'main', busy: r.busy, tx: r.tx, power: r.power === 'HI' ? '25W' : '1W', group: r.settings.group,
      gps: pos?.source === 'gps' ? 'ok' : 'blink', mail: r.mail,
      autoSw: r.settings.chAutoSw !== 'Accept after 10 sec.',
      mode: r.mode, channel: pad2(ch), name: r.settings.chDisplay === 'Number+Name' ? r.chName(ch) : '',
      fav: r.settings.favs.includes(ch), call: ch === r.settings.callChannel, dup: r.isDuplex(ch),
      scan: r.scan ? (r.scan === 'priority' ? 'SC 16' : 'SCAN') : '',
      watch: r.watch && !r.scan ? `${r.watch}  16` : '',
      pos: pv, soft: this.page().map((f) => this.label(f)).concat(['', '', '', '']).slice(0, 4),
    };
    if (this.overlay) v.overlay = this.overlay.kind === 'vol'
      ? { label: 'Volume', value: r.settings.volume, max: 30 } : { label: 'SQL', value: r.settings.squelch, max: 9 };
    if (this.toast) v.toast = this.toast.text;
    if (this.closeup) v.closeup = this.closeup.text;
    return v;
  }

  stepChannel(dir: 1 | -1, favOnly = false): void {
    const { r } = this;
    let list = r.channels;
    if (favOnly && r.settings.favs.length) list = list.filter((c) => r.settings.favs.includes(c));
    const cur = r.rxChannel();
    const i = list.indexOf(cur);
    let next: number;
    if (i >= 0) next = list[(i + dir + list.length) % list.length];
    else next = (dir === 1 ? list.find((c) => c > cur) : [...list].reverse().find((c) => c < cur)) ?? list[dir === 1 ? 0 : list.length - 1];
    if (r.watch && r.rxChannel() !== r.channel) r.channel = r.rxChannel();
    r.setChannel(next);
  }

  key(k: Key): void {
    const { r } = this;
    const s = r.settings;
    switch (k) {
      case 'UP': this.stepChannel(1); break;
      case 'DOWN': this.stepChannel(-1); break;
      case 'MICUP': this.stepChannel(1, s.favOnMic); break;
      case 'MICDOWN': this.stepChannel(-1, s.favOnMic); break;
      case 'LEFT': this.softPage--; break;
      case 'RIGHT': this.softPage++; break;
      case 'MENU': r.push(buildMenu(r)); r.emit('menu'); break;
      case 'CH16': r.setChannel(16, '16'); break;
      case 'HILO': this.togglePower(); break;
      case 'DIAL':
        if (!this.overlay) this.overlay = { kind: 'vol', ttl: 5000 };
        else if (this.overlay.kind === 'vol') this.overlay = { kind: 'sql', ttl: 5000 };
        else this.overlay = null;
        break;
      case 'CW': case 'CCW': {
        const d = k === 'CW' ? 1 : -1;
        const kind = this.overlay?.kind ?? 'vol';
        this.overlay = { kind, ttl: 5000 };
        if (kind === 'vol') { s.volume = Math.max(0, Math.min(30, s.volume + d)); r.emit('volume', { v: s.volume }); }
        else { s.squelch = Math.max(0, Math.min(9, s.squelch + d)); r.emit('squelch', { v: s.squelch }); }
        break;
      }
      case 'SOFT1': case 'SOFT2': case 'SOFT3': case 'SOFT4': {
        const f = this.page()[Number(k[4]) - 1];
        if (f) this.softAction(f);
        break;
      }
    }
  }

  private togglePower(): void {
    const { r } = this;
    if (LOW_ONLY.has(r.rxChannel())) { r.toast('Low power only'); return; }
    r.hiPower = !r.hiPower;
    r.emit('tx-power', { power: r.power });
  }

  private softAction(f: SoftFunc): void {
    const { r } = this;
    switch (f) {
      case 'DISTRESS': r.push(distressScreen(r)); break;
      case 'OTHER DSC': r.push(otherDscScreen(r)); break;
      case 'SCAN': this.toggleScan(); break;
      case 'DW/TW': this.toggleWatch(); break;
      case 'CHAN':
        if (r.special) r.setChannel(r.prevChannel);
        break;
      case 'HI/LO': this.togglePower(); break;
      case 'AQUA': r.sound('aqua'); r.toast('AquaQuake'); r.emit('aqua'); break;
      case 'FAV': {
        const favs = r.settings.favs;
        const i = favs.indexOf(r.channel);
        if (i >= 0) favs.splice(i, 1); else favs.push(r.channel);
        r.emit('fav', { ch: r.channel, on: i < 0 });
        break;
      }
      case 'NAME':
        r.push(new NameScreen(r, 'CH NAME', r.chName(r.channel), (v) => { r.settings.names[r.channel] = v; r.pop(); }));
        break;
      case 'BKLT': r.push(backlightScreen(r)); break;
      case 'LOG':
        r.push(new ListScreen(r, 'LOG', () => [{ label: 'Received Call Log' }, { label: 'Distress Log' }], (i) => {
          r.emit('log-view'); r.mail = 'off';
          r.push(logScreen(r, i === 0 ? r.rxLog : r.rxLog.filter((c) => c.type.startsWith('Distress')), i === 0 ? 'RCVD LOG' : 'DISTRESS LOG'));
        }));
        break;
    }
  }

  toggleScan(): void {
    const { r } = this;
    if (r.scan) { r.channel = r.scanCh; r.scan = null; r.emit('scan', { on: false }); return; }
    r.watch = null;
    r.scan = r.settings.scanType === 'Priority' ? 'priority' : 'normal';
    r.scanCh = r.channel; this.scanIdx = 0; this.scanHold = 0; this.scanAcc = 0;
    r.emit('scan', { on: true, type: r.scan });
  }

  toggleWatch(): void {
    const { r } = this;
    if (r.watch) { r.watch = null; r.emit('watch', { on: false }); return; }
    if (r.channel === 16) { r.toast('Not available on CH 16'); return; }
    r.scan = null;
    r.watch = r.settings.watchMode === 'Dual Watch' ? 'DW' : 'TW';
    r.emit('watch', { on: true, mode: r.watch });
  }

  private scanList(): number[] {
    const { r } = this;
    let l = r.settings.favs.length ? [...r.settings.favs].sort((a, b) => a - b) : r.channels;
    l = l.filter((c) => c !== 70);
    if (r.scan === 'priority') l = l.flatMap((c) => [c, 16]);
    return l;
  }

  tick(dt: number): void {
    const { r } = this;
    for (const key of ['overlay', 'toast', 'closeup'] as const) {
      const o = this[key];
      if (o && 'ttl' in o) { o.ttl -= dt; if (o.ttl <= 0) this[key] = null; }
    }
    if (r.busy) { r.mode = 'RT'; r.lastAct = r.time; }
    const lim = { Off: 0, '1 min': 60, '2 min': 120, '5 min': 300, '10 min': 600, '30 min': 1800 }[r.settings.inactivity] ?? 0;
    if (lim && r.mode === 'RT' && r.time - r.lastAct > lim * 1000) r.mode = 'STBY';
    if (r.scan) this.scanStep(dt);
  }

  private scanStep(dt: number): void {
    const { r } = this;
    if (r.signalOn(r.scanCh) && r.scan) { this.scanHold = { Off: 0, '5 sec': 5000, '10 sec': 10000 }[r.settings.scanTimer] ?? 5000; return; }
    if (this.scanHold > 0) { this.scanHold -= dt; return; }
    this.scanAcc += dt;
    if (this.scanAcc < 250) return;
    this.scanAcc = 0;
    const l = this.scanList();
    this.scanIdx = (this.scanIdx + 1) % l.length;
    r.scanCh = l[this.scanIdx];
  }
}

export function logScreen(r: Radio, list: CallRecord[], title: string): Screen {
  return new ListScreen(
    r, title,
    () => (list.length ? list.map((c) => ({ label: `${c.type}`, value: c.peer })) : [{ label: '(empty)', dim: true }]),
    (i) => {
      const c = list[i];
      if (!c) return;
      r.push({
        view: () => ({ kind: 'text', title: c.type.toUpperCase(), lines: [`FROM/TO: ${c.peer}`, c.nature ? `NATURE: ${c.nature}` : '', c.cat ? `CAT: ${c.cat}` : '', c.ch ? `CH ${pad2(c.ch)}` : '', c.time].filter(Boolean), soft: ['EXIT', 'BACK', '', ''] }),
        key: (k) => { if (k === 'CLR' || k === 'SOFT2') r.pop(); else if (k === 'MENU' || k === 'SOFT1') r.popToMain(); },
      });
    },
  );
}
