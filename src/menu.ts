import type { Radio } from './radio';
import { EntryScreen, ListScreen, optionScreen } from './screens';
import type { Key, LcdView, Row, Screen, Station } from './types';
import { SOFT_FUNCS } from './types';
import { distressScreen, otherDscScreen } from './dsc';
import { pad2 } from './channels';

interface Item { label: string; value?: () => string; open: () => void }

function menuList(r: Radio, title: string, items: () => Item[], opts: { onBack?: () => void } = {}): Screen {
  const rows = (): Row[] => items().map((i) => ({ label: i.label, value: i.value?.() }));
  return new ListScreen(r, title, rows, (i) => items()[i].open(), opts);
}

const choice = <T extends string>(r: Radio, label: string, options: readonly T[], get: () => T, set: (v: T) => void): Item => ({
  label, value: get, open: () => r.push(optionScreen(r, label.toUpperCase(), options, get(), (v) => { set(v); r.emit('setting', { label, value: v }); })),
});
const onOff = (r: Radio, label: string, get: () => boolean, set: (v: boolean) => void): Item => ({
  label, value: () => (get() ? 'On' : 'Off'),
  open: () => r.push(optionScreen(r, label.toUpperCase(), ['On', 'Off'] as const, get() ? 'On' : 'Off', (v) => { set(v === 'On'); r.emit('setting', { label, value: v }); })),
});

/** Balken-Einstellung (Hintergrundbeleuchtung, Kontrast, Kanal-70-Squelch) */
class AdjustScreen implements Screen {
  constructor(
    private r: Radio, private title: string, private min: number, private max: number,
    private get: () => number, private set: (v: number) => void, private fmt: (v: number) => string = String,
  ) {}
  view(): LcdView {
    return { kind: 'text', title: this.title, lines: [`${this.fmt(this.get())}`, `[${'█'.repeat(this.get() - this.min)}${'░'.repeat(this.max - this.get())}]`], soft: ['EXIT', 'BACK', '', 'ENT'] };
  }
  key(k: Key): void {
    const d = k === 'UP' || k === 'RIGHT' || k === 'CW' ? 1 : k === 'DOWN' || k === 'LEFT' || k === 'CCW' ? -1 : 0;
    if (d) { this.set(Math.max(this.min, Math.min(this.max, this.get() + d))); this.r.emit('setting', { label: this.title, value: this.get() }); }
    else if (k === 'ENT' || k === 'CLR' || k === 'SOFT2' || k === 'SOFT4') this.r.pop();
    else if (k === 'MENU' || k === 'SOFT1') this.r.popToMain();
  }
}

export function backlightScreen(r: Radio): Screen {
  return new AdjustScreen(r, 'BACKLIGHT', 0, 7, () => r.settings.backlight, (v) => { r.settings.backlight = v; }, (v) => (v === 0 ? 'OFF' : String(v)));
}

/** Position (Breite, Länge, UTC-Zeit) manuell eingeben */
export function positionInput(r: Radio): Screen {
  const d = { t: 'd' as const };
  const lit = (c: string) => ({ t: 'lit' as const, c });
  const lat = (next: (v: string) => void) => new EntryScreen(r, 'LATITUDE', [d, d, lit('°'), d, d, lit('.'), d, d, { t: 'c', opts: ['N', 'S'] }], next);
  const lon = (next: (v: string) => void) => new EntryScreen(r, 'LONGITUDE', [d, d, d, lit('°'), d, d, lit('.'), d, d, { t: 'c', opts: ['E', 'W'] }], next);
  const time = (next: (v: string) => void) => new EntryScreen(r, 'UTC TIME', [d, d, lit(':'), d, d], next);
  return lat((la) => r.replace(lon((lo) => r.replace(time((t) => {
    r.manualPos = { lat: la, lon: lo, utc: t.replace(':', ''), at: r.time };
    r.popToMain();
    r.toast('Position saved');
    r.emit('pos-set', { lat: la, lon: lo, utc: t });
  })))));
}

function stationList(r: Radio, title: string, list: Station[], prefix: string): Screen {
  const rows = (): Row[] => [...list.map((s) => ({ label: s.name, value: s.mmsi })), ...(list.length ? [] : [{ label: '(empty)', dim: true }])];
  const entry = (done: (v: string) => void, initial?: string) =>
    new EntryScreen(r, 'MMSI', Array.from({ length: 9 }, () => ({ t: 'd' as const })), done, initial);
  return new ListScreen(r, title, rows, (i) => {
    const s = list[i];
    if (!s) return;
    r.push(menuList(r, s.name, () => [
      { label: 'Edit MMSI', open: () => r.push(entry((v) => { s.mmsi = v; r.pop(); r.pop(); }, s.mmsi)) },
      { label: 'Delete', open: () => { list.splice(i, 1); r.pop(); } },
    ]));
  }, {
    soft4: 'ADD',
    onSoft4: () => r.push(entry((v) => {
      list.push({ name: `${prefix} ${list.length + 1}`, mmsi: v });
      r.pop();
    })),
  });
}

export function buildMenu(r: Radio): Screen {
  const s = r.settings;

  const config = () => menuList(r, 'CONFIGURATION', () => [
    { label: 'Backlight', value: () => (s.backlight ? String(s.backlight) : 'OFF'), open: () => r.push(backlightScreen(r)) },
    { label: 'Display Contrast', value: () => String(s.contrast), open: () => r.push(new AdjustScreen(r, 'DISPLAY CONTRAST', 1, 8, () => s.contrast, (v) => { s.contrast = v; })) },
    onOff(r, 'Key Beep', () => s.keyBeep, (v) => { s.keyBeep = v; }),
    {
      label: 'Key Assignment', open: () => r.push(menuList(r, 'KEY ASSIGNMENT', () =>
        SOFT_FUNCS.map((f) => ({
          label: f, value: () => (s.hiddenKeys.includes(f) ? 'Hide' : 'Show'),
          open: () => { const i = s.hiddenKeys.indexOf(f); if (i >= 0) s.hiddenKeys.splice(i, 1); else s.hiddenKeys.push(f); },
        })))),
    },
    { label: 'UTC Offset', value: () => `${s.utcOffset >= 0 ? '+' : ''}${s.utcOffset}:00`, open: () => r.push(new AdjustScreen(r, 'UTC OFFSET', -12, 14, () => s.utcOffset, (v) => { s.utcOffset = v; }, (v) => `${v >= 0 ? '+' : ''}${v}:00`)) },
    choice(r, 'Inactivity Timer', ['Off', '1 min', '2 min', '5 min', '10 min', '30 min'] as const, () => s.inactivity as 'Off', (v) => { s.inactivity = v; }),
    onOff(r, 'GPS', () => s.gpsOn, (v) => { s.gpsOn = v; }),
  ]);

  const logs = () => menuList(r, 'DSC LOG', () => [
    { label: 'Received Call Log', open: () => { r.mail = 'off'; r.emit('log-view'); r.push(logList(r, 'RCVD LOG', true)); } },
    { label: 'Transmitted Call Log', open: () => { r.emit('log-view'); r.push(logList(r, 'TX LOG', false)); } },
  ]);

  const radioSettings = () => menuList(r, 'RADIO SETTINGS', () => [
    choice(r, 'Scan Type', ['Normal', 'Priority'] as const, () => s.scanType, (v) => { s.scanType = v; }),
    choice(r, 'Scan Timer', ['Off', '5 sec', '10 sec'] as const, () => s.scanTimer as 'Off', (v) => { s.scanTimer = v; }),
    choice(r, 'Dual/Tri-watch', ['Dual Watch', 'Tri Watch'] as const, () => s.watchMode, (v) => { s.watchMode = v; r.watch = null; }),
    choice(r, 'Channel Group', ['INT', 'ATIS'] as const, () => s.group, (v) => { s.group = v; }),
    { label: 'Call Channel', value: () => pad2(s.callChannel), open: () => r.push(new AdjustScreen(r, 'CALL CHANNEL', 1, 88, () => s.callChannel, (v) => { const dir = v > s.callChannel ? 1 : -1; let n = v; while (n >= 1 && n <= 88 && !r.channels.includes(n)) n += dir; if (r.channels.includes(n)) s.callChannel = n; }, pad2)) },
    {
      label: 'Fav Settings', open: () => r.push(menuList(r, 'FAV SETTINGS', () =>
        r.channels.map((c) => ({
          label: `CH ${pad2(c)} ${r.chName(c)}`, value: () => (s.favs.includes(c) ? '★' : ''),
          open: () => { const i = s.favs.indexOf(c); if (i >= 0) s.favs.splice(i, 1); else s.favs.push(c); r.emit('fav', { ch: c, on: i < 0 }); },
        })))),
    },
    onOff(r, 'Fav On MIC', () => s.favOnMic, (v) => { s.favOnMic = v; }),
    choice(r, 'CH Display', ['Number', 'Number+Name'] as const, () => s.chDisplay, (v) => { s.chDisplay = v; }),
    onOff(r, 'CH Close-up', () => s.chCloseup, (v) => { s.chCloseup = v; }),
  ]);

  const dscSettings = () => menuList(r, 'DSC SETTINGS', () => [
    { label: 'Position Input', open: () => r.push(positionInput(r)) },
    { label: 'Individual ID', open: () => r.push(stationList(r, 'INDIVIDUAL ID', s.individual, 'STATION')) },
    { label: 'Group ID', open: () => r.push(stationList(r, 'GROUP ID', s.groups, 'GROUP')) },
    choice(r, 'Auto ACK', ['Auto', 'Manual'] as const, () => s.autoAck, (v) => { s.autoAck = v; }),
    choice(r, 'CH Auto SW', ['Accept after 10 sec.', 'Manual', 'Auto'] as const, () => s.chAutoSw as 'Manual', (v) => { s.chAutoSw = v; }),
    choice(r, 'Data Output', ['On', 'Off'] as const, () => s.dataOutput as 'On', (v) => { s.dataOutput = v; }),
    onOff(r, 'Alarm Status', () => s.alarm, (v) => { s.alarm = v; }),
    { label: 'CH 70 SQL Level', value: () => String(s.ch70Sql), open: () => r.push(new AdjustScreen(r, 'CH 70 SQL LEVEL', 0, 9, () => s.ch70Sql, (v) => { s.ch70Sql = v; })) },
    {
      label: 'Self Test', open: () => r.push({
        view: () => ({ kind: 'text', title: 'SELF TEST', lines: ['DSC Receiver: OK', 'DSC Transmitter: OK', 'GPS: ' + (r.position() ? 'OK' : 'NO FIX')], soft: ['EXIT', 'BACK', '', ''] }),
        key: (k) => { if (k === 'CLR' || k === 'SOFT2') r.pop(); else if (k === 'MENU' || k === 'SOFT1') r.popToMain(); },
      }),
    },
  ]);

  const info = (title: string, lines: string[], onOpen?: () => void): Screen => {
    onOpen?.();
    return {
      view: () => ({ kind: 'text', title, lines, soft: ['EXIT', 'BACK', '', ''] }),
      key: (k) => { if (k === 'CLR' || k === 'SOFT2') r.pop(); else if (k === 'MENU' || k === 'SOFT1') r.popToMain(); },
    };
  };

  const atisInput = () => new EntryScreen(r, 'ATIS ID Input', Array.from({ length: 10 }, () => ({ t: 'd' as const })), (v) => {
    r.replace(new EntryScreen(r, 'Confirmation', Array.from({ length: 10 }, () => ({ t: 'd' as const })), (v2) => {
      if (v !== v2) { r.popToMain(); r.toast('Not matched'); return; }
      r.atis = v; r.popToMain(); r.toast('ATIS ID registered'); r.emit('atis-registered');
    }));
  });

  return menuList(r, 'MENU', () => [
    { label: 'Distress', open: () => r.push(distressScreen(r)) },
    { label: 'Other DSC', open: () => r.push(otherDscScreen(r)) },
    {
      label: 'GPS', open: () => {
        const p = r.position();
        r.push(info('GPS', p ? [`LAT ${p.lat}`, `LON ${p.lon}`, `UTC ${r.localTime()}`, 'COG 000°  SOG 0.0kt'] : ['NO POSITION']));
      },
    },
    { label: 'Configuration', open: () => r.push(config()) },
    { label: 'DSC Log', open: () => r.push(logs()) },
    { label: 'Radio Settings', open: () => r.push(radioSettings()) },
    { label: 'DSC Settings', open: () => r.push(dscSettings()) },
    {
      label: 'Radio Info', open: () => r.push(info('RADIO INFO', [`MMSI: ${r.mmsi ?? '---'}`, `ATIS ID: ${r.atis ?? '---'}`, 'Software: Ver 1.00', 'GPS: Ver 1.00'], () => r.emit('radio-info'))),
    },
    ...(r.atis ? [] : [{ label: 'ATIS ID Input', open: () => r.push(atisInput()) }]),
  ], { onBack: () => r.popToMain() });
}

function logList(r: Radio, title: string, rx: boolean): Screen {
  const list = rx ? r.rxLog : r.txLog;
  return new ListScreen(r, title, () => (list.length ? list.map((c) => ({ label: c.type, value: c.peer })) : [{ label: '(empty)', dim: true }]), (i) => {
    const c = list[i];
    if (!c) return;
    r.push({
      view: () => ({ kind: 'text', title: c.type.toUpperCase(), lines: [`${rx ? 'FROM' : 'TO'}: ${c.peer}`, c.nature ? `NATURE: ${c.nature}` : '', c.cat ? `CAT: ${c.cat}` : '', c.ch ? `CH ${pad2(c.ch)}` : '', c.time].filter(Boolean), soft: ['EXIT', 'BACK', '', ''] }),
      key: (k) => { if (k === 'CLR' || k === 'SOFT2') r.pop(); else if (k === 'MENU' || k === 'SOFT1') r.popToMain(); },
    });
  });
}
