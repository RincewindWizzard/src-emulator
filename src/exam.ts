import type { Radio, RadioEvent } from './radio';
import { GPS_POS } from './radio';

// ---------- Szenario ----------
export interface Scenario {
  ship: string; callsign: string; mmsi: string; position: string;
  nature: string; natureText: string; natureWords: string[]; dscNature: string;
  persons: number; extra: string;
}

const NUM_WORDS = ['null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];

const SHIPS: [string, string][] = [['Seeadler', 'DJAB'], ['Nordstern', 'DKLM'], ['Windrose', 'DFGH'], ['Sturmvogel', 'DNPQ']];
const NATURES: Pick<Scenario, 'nature' | 'natureText' | 'natureWords' | 'dscNature'>[] = [
  { nature: 'Feuer', natureText: 'Feuer im Maschinenraum', natureWords: ['feuer', 'brand', 'brenn', 'fire'], dscNature: 'Fire/Explosion' },
  { nature: 'Wassereinbruch', natureText: 'Wassereinbruch nach Kollision mit Treibgut, Schiff droht zu sinken', natureWords: ['wasser', 'leck', 'sink', 'flood'], dscNature: 'Flooding' },
  { nature: 'Grundberührung', natureText: 'Grundberührung, Schiff sitzt fest und macht Wasser', natureWords: ['grund', 'auf grund', 'fest', 'gestrandet'], dscNature: 'Grounding' },
  { nature: 'Mann über Bord', natureText: 'Person über Bord gegangen', natureWords: ['über bord', 'ueber bord', 'mann', 'person über'], dscNature: 'Man Overboard' },
];

const spokenPos = (): string => {
  const f = (s: string, a: string, b: string) => s.replace(/(\d+)°(\d+)\.(\d+)([NSEW])/, (_m, d, m, c, h) => `${parseInt(d, 10)} Grad ${m},${c} Minuten ${h === 'N' || h === 'S' ? a : b}`);
  return `${f(GPS_POS.lat, 'Nord', 'Süd')}, ${f(GPS_POS.lon, 'Ost', 'West')}`.replace(/Ost|West/, (m) => m);
};

export function makeScenario(mmsi: string, rnd: () => number = Math.random): Scenario {
  const [ship, callsign] = SHIPS[Math.floor(rnd() * SHIPS.length)];
  const n = NATURES[Math.floor(rnd() * NATURES.length)];
  const persons = 2 + Math.floor(rnd() * 5);
  return {
    ship, callsign, mmsi, position: spokenPos(),
    ...n, persons, extra: 'Segelyacht, 11 Meter, weißer Rumpf, Rettungsinsel klar',
  };
}

// ---------- Text-Auswertung ----------
const PHON: Record<string, string> = {
  alfa: 'a', alpha: 'a', bravo: 'b', charlie: 'c', delta: 'd', echo: 'e', foxtrot: 'f', golf: 'g', hotel: 'h', india: 'i',
  juliett: 'j', juliet: 'j', kilo: 'k', lima: 'l', mike: 'm', november: 'n', oscar: 'o', papa: 'p', quebec: 'q', romeo: 'r',
  sierra: 's', tango: 't', uniform: 'u', victor: 'v', viktor: 'v', whiskey: 'w', whisky: 'w', xray: 'x', yankee: 'y', zulu: 'z',
};
const DIGIT_WORDS: Record<string, string> = {
  null: '0', eins: '1', ein: '1', zwei: '2', zwo: '2', drei: '3', vier: '4', fünf: '5', fuenf: '5', sechs: '6', sieben: '7', acht: '8', neun: '9',
};

export const normalize = (t: string): string =>
  t.toLowerCase().replace(/x-ray/g, 'xray').replace(/[.,;:!?"„“()\-/]/g, ' ').replace(/\s+/g, ' ').trim();

const MAYDAY = /\b(may ?day|mai ?day|mei ?day|mäh ?day|mäde|mede|medeh|made|may ?they|meyday)\b/g;

export type Status = 'ok' | 'miss' | 'warn';
export interface Item { id: string; text: string; status: Status; note?: string }

export interface ContentResult {
  mayday: number; hierIst: boolean; shipCount: number; callsign: boolean; mmsi: boolean; secondMayday: boolean;
  position: boolean; nature: boolean; help: boolean; persons: boolean; extra: boolean; over: boolean;
}

export function analyzeContent(raw: string, sc: Scenario): ContentResult {
  const t = normalize(raw);
  const compact = t.replace(/ /g, '');
  const tokens = t.split(' ').filter(Boolean);
  const ship = sc.ship.toLowerCase();
  const maydays = [...t.matchAll(MAYDAY)];
  const hier = t.search(/\bhier (ist|ich bin)\b|\bthis is\b/);
  const shipCount = compact.split(ship).length - 1;
  // Rufzeichen: phonetisch, buchstabiert oder am Stück
  const letters = tokens.map((w) => PHON[w] ?? (w.length === 1 && /[a-z]/.test(w) ? w : '|')).join('');
  const callsign = letters.includes(sc.callsign.toLowerCase()) || compact.includes(sc.callsign.toLowerCase());
  const digits = tokens.map((w) => (/^\d+$/.test(w) ? w : DIGIT_WORDS[w] ?? '|')).join('');
  const mmsi = digits.includes(sc.mmsi) || compact.includes(sc.mmsi);
  const afterFirst = maydays.length > 3 || (maydays.length >= 4);
  const personWord = NUM_WORDS[sc.persons];
  return {
    mayday: maydays.length,
    hierIst: hier >= 0,
    shipCount,
    callsign,
    mmsi,
    secondMayday: afterFirst && shipCount >= 4,
    position: /\bposition\b|\bpos\b|\bmeine position\b|\bgrad\b|\bnord\b|\bost\b|breite|länge/.test(t) && /\d|null|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|vierundfünfzig/.test(t),
    nature: sc.natureWords.some((w) => t.includes(w)),
    help: /(brauche|benötige|benoetige|erbitte|erbeten|ersuche|sofortige hilfe|sofort hilfe|hilfe)/.test(t),
    persons: new RegExp(`(${sc.persons}|${personWord}) ?(personen|mann|menschen|leute|crew|besatzung)|personen an bord|personen:? ?(${sc.persons}|${personWord})`).test(t),
    extra: /(rettungsinsel|rettungsweste|rettungsmittel|rettungsboot|segelyacht|yacht|meter|rumpf|länge|farbe|treibt|insel|schiffsbeschreibung|beschreibung)/.test(t),
    over: /\b(over|kommen|ouwer|over over)\b/.test(t),
  };
}

// ---------- Prüfung ----------
export interface Transmission {
  text: string; ch: number; power: string; noise: boolean; volume: number; t: number; afterDsc: boolean; afterAck: boolean;
}
export interface Line { who: 'me' | 'kfs' | 'sys'; text: string }

export class Exam {
  running = false;
  finished = false;
  sc: Scenario;
  tx: Transmission[] = [];
  lines: Line[] = [];
  events: RadioEvent[] = [];
  overrides = new Map<string, Status>();
  closed = false;
  replies = 0;
  onChange: () => void = () => {};
  speak: (text: string, done: () => void) => void = (_t, d) => d();
  private dscAt = -1;
  private ackAt = -1;
  private pttStart: { t: number; ch: number; power: string; noise: boolean; volume: number } | null = null;

  constructor(private r: Radio, rnd: () => number = Math.random) {
    this.sc = makeScenario(r.mmsi ?? '211000001', rnd);
    r.listeners.push((e) => this.onEvent(e));
  }

  start(rnd?: () => number): void {
    this.sc = makeScenario(this.r.mmsi ?? '211000001', rnd);
    this.running = true; this.finished = false; this.closed = false; this.replies = 0;
    this.tx = []; this.lines = []; this.events = []; this.overrides.clear();
    this.dscAt = -1; this.ackAt = -1; this.pttStart = null;
    this.r.sim.coastAck = true;
    this.lines.push({ who: 'sys', text: 'Prüfung gestartet. Gerät bedienen, DSC-Notalarm senden und die Notmeldung per Sprechfunk (PTT halten) sprechen.' });
    this.onChange();
  }

  end(): void { this.running = false; this.finished = true; this.onChange(); }

  private onEvent(e: RadioEvent): void {
    if (!this.running) return;
    this.events.push(e);
    if (e.type === 'distress-sent' && this.dscAt < 0) this.dscAt = e.t;
    if (e.type === 'distress-ack' && this.ackAt < 0) this.ackAt = e.t;
    if (e.type === 'ptt-start') this.pttStart = { t: e.t, ch: e.channel as number, power: e.power as string, noise: e.noise as boolean, volume: e.volume as number };
    this.onChange();
  }

  /** Von der UI aufgerufen, wenn die PTT-Taste losgelassen wurde und der erkannte Text vorliegt */
  submit(text: string): void {
    if (!this.running) return;
    const p = this.pttStart ?? { t: this.r.time, ch: this.r.channel, power: this.r.power, noise: false, volume: this.r.settings.volume };
    this.pttStart = null;
    const clean = text.trim();
    if (!clean) { this.lines.push({ who: 'sys', text: '(nichts erkannt)' }); this.onChange(); return; }
    const t: Transmission = { text: clean, ch: p.ch, power: p.power, noise: p.noise, volume: p.volume, t: p.t, afterDsc: this.dscAt >= 0 && this.dscAt <= p.t, afterAck: this.ackAt >= 0 && this.ackAt <= p.t };
    this.tx.push(t);
    this.lines.push({ who: 'me', text: clean });
    this.onChange();
    if (p.ch !== 16) { this.lines.push({ who: 'sys', text: `Keine Antwort – Sie haben auf Kanal ${p.ch} gesendet, nicht auf Kanal 16.` }); this.onChange(); return; }
    this.r.schedule(1500, () => this.reply());
  }

  private allText(): string { return this.tx.filter((t) => t.ch === 16).map((t) => t.text).join(' . '); }

  /** Text der Gegenstelle (Küstenfunkstelle) auf Basis des bisher Gesendeten */
  replyText(): string {
    const { sc } = this;
    const c = analyzeContent(this.allText(), sc);
    const name = `${sc.ship}, `.repeat(3).trimEnd().replace(/,$/, '');
    const who = 'hier ist Bremen Rescue Radio, Bremen Rescue Radio, Bremen Rescue Radio';
    if (c.mayday === 0) return 'Hier ist Bremen Rescue Radio. Ich habe keinen Notruf verstanden. Bitte wiederholen. Kommen.';
    const missing: string[] = [];
    if (c.shipCount === 0) missing.push('Ihren Schiffsnamen');
    if (!c.position) missing.push('Ihre Position');
    if (!c.nature) missing.push('die Art der Notlage');
    if (missing.length) return `MAYDAY, hier ist Bremen Rescue Radio. Ich habe Ihren Notruf nicht vollständig verstanden. Bitte wiederholen Sie ${missing.join(' und ')}. Kommen.`;
    this.replies++;
    if (!c.persons) return `MAYDAY ${name}, ${who}, empfange Ihren Notruf. Wie viele Personen sind an Bord? Kommen.`;
    if (!c.extra) return `MAYDAY ${sc.ship}, hier ist Bremen Rescue Radio. Bitte geben Sie eine Beschreibung Ihres Schiffes und die vorhandenen Rettungsmittel an. Kommen.`;
    this.closed = true;
    return `MAYDAY ${sc.ship}, hier ist Bremen Rescue Radio. Alles verstanden. Seenotrettungskreuzer ist alarmiert und unterwegs. Halten Sie Kanal 16 und melden Sie Änderungen. Kommen.`;
  }

  private reply(): void {
    if (!this.running) return;
    const text = this.replyText();
    this.lines.push({ who: 'kfs', text });
    this.onChange();
    this.speak(text, () => {
      if (this.closed) this.lines.push({ who: 'sys', text: 'Die Gegenstelle hat alles verstanden. Sie können die Prüfung beenden und die Auswertung ansehen.' });
      this.onChange();
    });
  }

  // ---------- Auswertung ----------
  checklist(): { section: string; items: Item[] }[] {
    const { sc, r } = this;
    const ev = (t: string) => this.events.filter((e) => e.type === t);
    const sent = ev('distress-sent')[0];
    const ptt = this.tx.length ? this.tx[0] : null;
    const rec = (id: string, text: string, ok: boolean, note?: string, warn = false): Item => {
      const o = this.overrides.get(id);
      return { id, text, status: o ?? (ok ? 'ok' : warn ? 'warn' : 'miss'), note: o ? 'manuell geändert' : ok ? undefined : note };
    };
    const device: Item[] = [
      rec('cover', 'Tastenabdeckung der DISTRESS-Taste angehoben', ev('cover').some((e) => e.open), 'Abdeckung nicht geöffnet.'),
      rec('dsc', 'DSC-Notalarm gesendet (DISTRESS-Taste 3 s gehalten)', !!sent, 'Es wurde kein DSC-Notalarm abgesetzt.'),
      rec('nature', `Art der Notlage im DSC-Alarm passend gewählt (${sc.dscNature})`, sent?.nature === sc.dscNature, sent?.nature === 'Undesignated' ? 'Notlage "Undesignated" gesendet – besser die passende Art wählen.' : 'Art der Notlage nicht passend.', sent?.nature === 'Undesignated'),
      rec('pos', 'Position im DSC-Alarm enthalten (GPS oder manuell)', !!sent?.pos, 'Keine Position im Alarm – Position vorher eingeben.'),
      rec('ack', 'Quittung der Küstenfunkstelle abgewartet, bevor gesprochen wurde', !!ptt && ptt.afterAck, 'Sprechfunkmeldung vor der DSC-Quittung begonnen (oder gar nicht gesprochen).', true),
      rec('ch16', 'Notmeldung auf Kanal 16 gesendet', !!ptt && this.tx.some((t) => t.ch === 16), 'Nicht auf Kanal 16 gesendet.'),
      rec('hi', 'Mit hoher Sendeleistung (25 W) gesendet', this.tx.some((t) => t.ch === 16 && t.power === 'HI'), 'Niedrige Sendeleistung: im Notfall HI wählen.'),
      rec('sql', 'Rauschsperre und Lautstärke sinnvoll eingestellt (kein Dauerrauschen, hörbar)', !!ptt && !ptt.noise && ptt.volume > 0, 'Rauschsperre offen (Dauerrauschen) oder Lautstärke 0.', true),
    ];
    const c = analyzeContent(this.allText(), sc);
    const voice: Item[] = [
      rec('mayday', 'MAYDAY dreimal gesprochen', c.mayday >= 3, c.mayday ? `Nur ${c.mayday}× erkannt.` : 'Kein MAYDAY erkannt.'),
      rec('hier', '"Hier ist" + Schiffsname dreimal', c.hierIst && c.shipCount >= 3, `Schiffsname ${c.shipCount}× erkannt (erwartet: ${sc.ship}).`),
      rec('callsign', `Rufzeichen genannt (${sc.callsign}, buchstabiert)`, c.callsign, 'Rufzeichen nicht erkannt.'),
      rec('mmsi', `MMSI genannt (${sc.mmsi})`, c.mmsi, 'MMSI nicht erkannt.', true),
      rec('again', 'MAYDAY + Schiffsname + Rufzeichen wiederholt (vor der Notlage)', c.secondMayday, 'Wiederholung "MAYDAY Schiffsname" nicht erkannt.', true),
      rec('position', 'Position genannt', c.position, 'Position fehlt.'),
      rec('nature-v', `Art der Notlage genannt (${sc.natureText})`, c.nature, 'Art der Notlage fehlt.'),
      rec('help', 'Art der benötigten Hilfe genannt', c.help, 'Hilfeersuchen fehlt.', true),
      rec('persons', `Zahl der Personen an Bord (${sc.persons})`, c.persons, 'Personenzahl fehlt.'),
      rec('extra', 'Weitere Angaben (Schiffsbeschreibung, Rettungsmittel)', c.extra, 'Keine weiteren Angaben.', true),
      rec('over', 'Schluss mit "Kommen"/"Over"', c.over, 'Kein Sprechschluss.', true),
    ];
    const flow: Item[] = [
      rec('reply', 'Gegenstelle hat den Notruf bestätigt und alles verstanden', this.closed, 'Die Gegenstelle hat noch nicht alle Angaben erhalten.', true),
    ];
    void r;
    return [{ section: 'Bedienung am Gerät', items: device }, { section: 'Notmeldung (Sprechfunk)', items: voice }, { section: 'Ablauf', items: flow }];
  }

  score(): { ok: number; total: number } {
    const all = this.checklist().flatMap((s) => s.items);
    return { ok: all.filter((i) => i.status === 'ok').length, total: all.length };
  }
}
