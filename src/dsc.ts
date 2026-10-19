import { CHANNELS, pad2 } from './channels';
import type { Radio } from './radio';
import { ChannelPickScreen, EntryScreen, ListScreen, optionScreen } from './screens';
import type { Key, LcdView, Row, Screen, Station } from './types';

export const NATURES = [
  'Undesignated', 'Fire/Explosion', 'Flooding', 'Collision', 'Grounding', 'Listing/Capsizing',
  'Sinking', 'Disabled/Adrift', 'Abandoning Ship', 'Piracy', 'Man Overboard',
] as const;

const hms = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
};

/** Bildschirm mit wiederholtem Alarmton, bis eine Softtaste gedrückt wird */
class AlarmScreen implements Screen {
  private el = 0;
  private acc = 1000;
  alarm = true;
  constructor(
    protected r: Radio,
    private title: string,
    private lines: (el: number) => string[],
    private off: () => void,
  ) {}
  view(): LcdView {
    return { kind: 'text', title: this.title, lines: this.lines(this.el), soft: ['', '', '', this.alarm ? 'ALARM OFF' : 'OK'], alert: true };
  }
  tick(dt: number): void {
    this.el += dt;
    if (!this.alarm) return;
    this.acc += dt;
    if (this.acc >= 1000) { this.acc = 0; if (this.r.settings.alarm) this.r.sound('alarm'); }
  }
  key(k: Key): void {
    if (k === 'SOFT1' || k === 'SOFT2' || k === 'SOFT3' || k === 'SOFT4' || k === 'ENT') this.off();
  }
}

// ---------- Notruf ----------
export function distressScreen(r: Radio): Screen {
  const pos = () => r.position();
  return new ListScreen(
    r, '!! DISTRESS !!',
    () => [
      { label: 'Nature', value: r.distressNature },
      { label: 'Position', value: pos() ? pos()!.lat.replace(/\.\d\d/, '') + ' ' + pos()!.lon.replace(/\.\d\d/, '') : 'NO POS' },
    ],
    (i) => {
      if (i === 0) r.push(optionScreen(r, 'NATURE', NATURES, r.distressNature as (typeof NATURES)[number], (v) => { r.distressNature = v; }));
    },
    { hint: 'Hold [DISTRESS] 3 sec.' },
  );
}

/** Wird beim Drücken von [DISTRESS] gestartet (nur mit angehobener Tastenabdeckung) */
export function beginDistressHold(r: Radio): void {
  if (!r.coverOpen) return;
  if (!r.mmsi) { r.toast('No MMSI'); return; }
  if (r.distressActive) return;
  r.emit('distress-hold');
  let beeps = 0;
  const s: Screen = {
    view: () => ({ kind: 'text', title: '!! DISTRESS !!', lines: ['Hold Down', `for ${Math.max(0, 3 - Math.floor(r.heldMs('DISTRESS') / 1000))} sec.`], soft: ['', '', '', ''], alert: true }),
    key: () => {},
    tick: () => {
      if (!r.isHeld('DISTRESS')) { if (r.top === s) r.pop(); return; }
      const sec = Math.floor(r.heldMs('DISTRESS') / 1000);
      while (beeps < Math.min(sec, 3)) { beeps++; r.sound(beeps === 3 ? 'longbeep' : 'beep'); }
      if (sec >= 3) r.replace(new DistressTx(r));
    },
  };
  r.push(s);
}

class DistressTx implements Screen {
  private phase: 'tx' | 'wait' | 'ack' | 'active' = 'tx';
  private t = 0;
  private nextTx = 0;
  private ackTimer = 0;
  private el = 0;
  private acc = 0;
  private alarmAcc = 1000;
  private sentAt = 0;
  constructor(private r: Radio) {
    r.distressActive = true;
    this.begin();
  }
  private begin(): void {
    this.phase = 'tx'; this.t = 0;
    this.r.sound('dsc');
    this.r.cancel(this.ackTimer);
  }
  private sent(): void {
    const r = this.r;
    const p = r.position();
    r.txLog.unshift({ time: r.nowStamp(), type: 'Distress', peer: 'ALL SHIPS', nature: r.distressNature });
    r.emit('distress-sent', { nature: r.distressNature, pos: p ? `${p.lat} ${p.lon}` : null });
    this.phase = 'wait';
    this.nextTx = 210000 + Math.floor(Math.random() * 60000);
    this.sentAt = r.time;
    if (r.sim.coastAck) this.ackTimer = r.schedule(r.sim.coastAckDelayMs, () => this.gotAck());
  }
  private gotAck(): void {
    if (this.phase !== 'wait') return;
    const r = this.r;
    this.phase = 'ack'; this.el = 0;
    r.setChannel(16, '16');
    r.rxLog.unshift({ time: r.nowStamp(), type: 'Distress ACK', peer: '002111240', ch: 16 });
    r.emit('distress-ack');
  }
  private finish(type: string): void {
    this.r.cancel(this.ackTimer);
    this.r.distressActive = false;
    this.r.popToMain();
    this.r.emit(type);
  }
  view(): LcdView {
    const hdr = '!! DISTRESS !!';
    switch (this.phase) {
      case 'tx': return { kind: 'text', title: hdr, lines: ['Transmitting', 'Distress Alert'], soft: ['', '', '', ''], alert: true };
      case 'wait': {
        const rem = Math.max(0, this.nextTx - (this.r.time - this.sentAt));
        return { kind: 'text', title: hdr, lines: ['Waiting for ACK', `Next TX after`, `${Math.floor(rem / 60000)} min ${Math.floor(rem / 1000) % 60} sec.`], soft: ['CANCEL', '', '', 'RESEND'], alert: true };
      }
      case 'ack':
        return { kind: 'text', title: 'RCVD DISTRESS ACK', lines: ['FROM: 002111240', 'CH 16', `ELAPSED: ${hms(this.el)}`], soft: ['', '', '', 'ALARM OFF'], alert: true };
      default:
        return { kind: 'text', title: hdr, lines: ['ACK received', 'CH 16', 'Hold [PTT] to talk'], soft: ['CANCEL', '', '', ''], alert: true };
    }
  }
  tick(dt: number): void {
    const r = this.r;
    this.acc += dt;
    if (this.phase === 'tx') { this.t += dt; if (this.t >= 2000) this.sent(); }
    else if (this.phase === 'wait' && r.time - this.sentAt >= this.nextTx) this.begin();
    else if (this.phase === 'ack') {
      this.el += dt; this.alarmAcc += dt;
      if (this.alarmAcc >= 1000) { this.alarmAcc = 0; r.sound('alarm'); }
    }
  }
  key(k: Key): void {
    if (this.phase === 'wait') {
      if (k === 'SOFT1' || k === 'CLR') this.finish('distress-cancel');
      else if (k === 'SOFT4') this.begin();
    } else if (this.phase === 'ack') {
      if (k.startsWith('SOFT') || k === 'ENT') { this.phase = 'active'; }
    } else if (this.phase === 'active') {
      if (k === 'SOFT1' || k === 'CLR') this.finish('distress-end');
    }
  }
}

// ---------- Andere DSC-Rufe ----------
type CallType = 'Individual' | 'Group' | 'All Ships' | 'Test';
interface CallForm { type: CallType; address: Station | null; category: string; channel: number }

const callChannels = (type: CallType): number[] => (type === 'All Ships' ? [16] : CHANNELS.filter((c) => c !== 16 && c !== 70));

export function otherDscScreen(r: Radio): Screen {
  const f: CallForm = { type: 'Individual', address: r.settings.individual[0] ?? null, category: 'Routine', channel: 8 };
  const rows = () => {
    const out: Row[] = [{ label: 'Type', value: f.type }];
    if (f.type !== 'All Ships') out.push({ label: 'Address', value: f.address ? f.address.name || f.address.mmsi : '---' });
    if (f.type !== 'Test') out.push({ label: 'Category', value: f.category });
    if (f.type === 'Individual' || f.type === 'Group') out.push({ label: 'Mode', value: 'Telephony' });
    if (f.type !== 'Test') out.push({ label: 'Channel', value: pad2(f.channel) });
    return out;
  };
  const setType = (t: CallType) => {
    f.type = t;
    const list = t === 'Group' ? r.settings.groups : r.settings.individual;
    f.address = t === 'All Ships' ? null : list[0] ?? null;
    f.category = t === 'All Ships' ? 'Safety' : 'Routine';
    f.channel = t === 'All Ships' ? 16 : f.channel === 16 ? 8 : f.channel;
  };
  const screen = new ListScreen(r, 'OTHER DSC', rows, (i) => {
    const label = rows()[i].label;
    if (label === 'Type') r.push(optionScreen(r, 'TYPE', ['Individual', 'Group', 'All Ships', 'Test'] as const, f.type, setType));
    else if (label === 'Address') r.push(addressScreen(r, f));
    else if (label === 'Category') r.push(optionScreen(r, 'CATEGORY', f.type === 'All Ships' ? ['Safety', 'Urgency'] : ['Routine', 'Safety', 'Urgency'], f.category, (v) => { f.category = v; }));
    else if (label === 'Mode') r.push(optionScreen(r, 'MODE', ['Telephony'], 'Telephony', () => {}));
    else if (label === 'Channel') r.push(new ChannelPickScreen(r, callChannels(f.type), f.channel, (ch) => { f.channel = ch; r.pop(); }));
  }, {
    soft4: 'CALL',
    onSoft4: () => {
      if (f.type !== 'All Ships' && !f.address) { r.toast('Select address'); return; }
      r.replace(new CallTx(r, { ...f }));
    },
  });
  return screen;
}

function addressScreen(r: Radio, f: CallForm): Screen {
  const list = f.type === 'Group' ? r.settings.groups : r.settings.individual;
  return new ListScreen(
    r, 'ADDRESS',
    () => [...list.map((s) => ({ label: s.name || s.mmsi, value: s.mmsi })), { label: 'Manual Input' }],
    (i) => {
      if (i < list.length) { f.address = list[i]; r.pop(); return; }
      r.push(new EntryScreen(r, 'MANUAL INPUT', Array.from({ length: 9 }, () => ({ t: 'd' as const })), (v) => {
        f.address = { name: v, mmsi: v }; r.pop(); r.pop();
      }));
    },
  );
}

const TITLES: Record<CallType, string> = { Individual: 'INDIVIDUAL CALL', Group: 'GROUP CALL', 'All Ships': 'ALL SHIPS CALL', Test: 'TEST CALL' };

class CallTx implements Screen {
  private phase: 'tx' | 'wait' | 'ack' | 'unable' = 'tx';
  private t = 0;
  private el = 0;
  private alarmAcc = 1000;
  private timer = 0;
  constructor(private r: Radio, private f: CallForm) { r.sound('dsc'); }
  private name(): string { return this.f.address ? this.f.address.name || this.f.address.mmsi : 'ALL SHIPS'; }
  private sent(): void {
    const { r, f } = this;
    r.txLog.unshift({ time: r.nowStamp(), type: `${f.type} Call`, peer: this.name(), ch: f.channel, cat: f.category });
    r.emit('call-sent', { kind: f.type, address: f.address?.mmsi ?? null, name: this.name(), ch: f.channel, cat: f.category });
    if (f.type === 'Group' || f.type === 'All Ships') {
      r.setChannel(f.channel, f.channel === 16 ? '16' : null);
      r.popToMain();
      return;
    }
    this.phase = 'wait'; this.el = 0;
    this.send();
  }
  private send(): void {
    const { r, f } = this;
    r.cancel(this.timer);
    if (r.sim.stationReply === 'none') return;
    this.timer = r.schedule(3000, () => {
      if (this.phase !== 'wait') return;
      this.phase = r.sim.stationReply === 'able' || f.type === 'Test' ? 'ack' : 'unable';
      if (f.type === 'Test' && r.sim.stationReply !== 'able') { this.phase = 'wait'; return; }
      this.el = 0;
    });
  }
  view(): LcdView {
    const { f } = this;
    switch (this.phase) {
      case 'tx': return { kind: 'text', title: TITLES[f.type], lines: ['Transmitting', `${f.type} Call`], soft: ['', '', '', ''] };
      case 'wait': return { kind: 'text', title: TITLES[f.type], lines: ['Waiting for ACK', `Elapsed: ${hms(this.el).slice(3)}`, `To: ${this.name()}`], soft: ['STBY', '', '', 'RESEND'] };
      case 'ack': return {
        kind: 'text', alert: true, title: f.type === 'Test' ? 'RCVD TEST ACK' : 'RCVD INDIV ACK',
        lines: [`FROM: ${this.name()}`, ...(f.type === 'Test' ? [] : [`CH ${pad2(f.channel)}`]), `ELAPSED: ${hms(this.el)}`], soft: ['', '', '', 'ALARM OFF'],
      };
      default: return { kind: 'text', alert: true, title: 'RCVD INDIV ACK', lines: [`FROM: ${this.name()}`, 'Unable to comply'], soft: ['', '', '', 'OK'] };
    }
  }
  tick(dt: number): void {
    const { r } = this;
    if (this.phase === 'tx') { this.t += dt; if (this.t >= 2000) this.sent(); return; }
    this.el += dt;
    if (this.phase === 'ack') { this.alarmAcc += dt; if (this.alarmAcc >= 1000) { this.alarmAcc = 0; r.sound('alarm'); } }
  }
  key(k: Key): void {
    const { r, f } = this;
    if (this.phase === 'wait') {
      if (k === 'SOFT1' || k === 'CLR') { r.cancel(this.timer); r.popToMain(); }
      else if (k === 'SOFT4') { this.el = 0; r.sound('dsc'); r.emit('call-sent', { kind: f.type, address: f.address?.mmsi ?? null, name: this.name(), ch: f.channel, cat: f.category, resend: true }); this.send(); }
    } else if (this.phase === 'ack' && (k.startsWith('SOFT') || k === 'ENT')) {
      r.emit('call-ack', { kind: f.type, able: true, ch: f.channel });
      if (f.type !== 'Test') { r.setChannel(f.channel); r.mode = 'RT'; }
      r.popToMain();
    } else if (this.phase === 'unable' && (k.startsWith('SOFT') || k === 'ENT' || k === 'CLR')) {
      r.emit('call-ack', { kind: f.type, able: false });
      r.popToMain();
    }
  }
}

// ---------- Empfangene Rufe (vom Simulator ausgelöst) ----------
export type IncomingKind = 'distress' | 'individual' | 'group' | 'all-urgency' | 'all-safety';

export function receiveCall(r: Radio, kind: IncomingKind, from = '211111110'): void {
  if (!r.on || !r.mmsi) return;
  const station = r.settings.individual.find((s) => s.mmsi === from);
  const who = station?.name ?? from;
  const ch = kind === 'individual' || kind === 'group' ? 8 : 16;
  const type = { distress: 'Distress', individual: 'Individual Call', group: 'Group Call', 'all-urgency': 'All Ships (Urgency)', 'all-safety': 'All Ships (Safety)' }[kind];
  r.rxLog.unshift({ time: r.nowStamp(), type, peer: who, ch, nature: kind === 'distress' ? 'Fire/Explosion' : undefined, cat: kind === 'individual' ? 'Routine' : undefined });
  r.mail = 'blink';
  r.emit('call-received', { kind });
  const title = { distress: 'RCVD DISTRESS', individual: 'RCVD INDIV CALL', group: 'RCVD GROUP CALL', 'all-urgency': 'RCVD ALL SHIPS', 'all-safety': 'RCVD ALL SHIPS' }[kind];
  r.sound('dsc');
  r.push(new AlarmScreen(
    r, title,
    (el) => [`FROM: ${who}`, ...(kind === 'all-urgency' ? ['URGENCY'] : kind === 'all-safety' ? ['SAFETY'] : []), `CH ${pad2(ch)}`, `ELAPSED: ${hms(el)}`],
    () => {
      r.emit('alarm-off', { kind });
      if (kind === 'distress') {
        r.setChannel(16, '16'); r.mode = 'RT';
        r.replace(infoScreen(r, 'DISTRESS ALERT', [`FROM: ${who}`, 'NATURE: Fire/Explosion', 'POS: 54°30N 008°00E', 'CH 16: listen!']));
      } else if (kind === 'individual') {
        if (r.settings.autoAck === 'Auto') { r.replace(new AckTx(r, who, ch, true)); }
        else r.replace(ackChoice(r, who, ch));
      } else {
        r.setChannel(ch, ch === 16 ? '16' : null);
        r.popToMain();
      }
    },
  ));
}

function infoScreen(r: Radio, title: string, lines: string[]): Screen {
  return {
    view: () => ({ kind: 'text', title, lines, soft: ['EXIT', '', '', ''] }),
    key: (k) => { if (k === 'SOFT1' || k === 'CLR' || k === 'MENU') r.popToMain(); },
  };
}

function ackChoice(r: Radio, who: string, ch: number): Screen {
  return {
    view: () => ({ kind: 'text', title: 'INDIVIDUAL CALL', lines: [`FROM: ${who}`, `Proposed CH ${pad2(ch)}`, 'Able to comply?'], soft: ['ABLE', 'UNABLE', '', ''] }),
    key: (k) => {
      if (k === 'SOFT1') r.replace(new AckTx(r, who, ch, true));
      else if (k === 'SOFT2') r.replace(new AckTx(r, who, ch, false));
      else if (k === 'CLR') r.popToMain();
    },
  };
}

class AckTx implements Screen {
  private t = 0;
  constructor(private r: Radio, _who: string, private ch: number, private able: boolean) { r.sound('dsc'); }
  view(): LcdView { return { kind: 'text', title: 'INDIVIDUAL CALL', lines: ['Transmitting', this.able ? 'Able to comply' : 'Unable to comply'], soft: ['', '', '', ''] }; }
  key(): void {}
  tick(dt: number): void {
    this.t += dt;
    if (this.t < 2000) return;
    this.r.emit('ack-sent', { able: this.able, ch: this.ch });
    if (this.able) { this.r.setChannel(this.ch); this.r.mode = 'RT'; }
    this.r.popToMain();
  }
}
