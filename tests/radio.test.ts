import { describe, expect, it } from 'vitest';
import { Radio } from '../src/radio';

const run = (r: Radio, ms: number) => { for (let i = 0; i < ms / 50; i++) r.tick(50); };
const powerOn = (): Radio => {
  const r = new Radio();
  r.down('DIAL'); run(r, 1100); r.up('DIAL'); run(r, 2000);
  return r;
};
const view = (r: Radio) => r.top.view() as any;

describe('Grundbedienung', () => {
  it('schaltet mit 1 s Drücken des DIAL ein und aus', () => {
    const r = powerOn();
    expect(r.on).toBe(true);
    expect(view(r).kind).toBe('main');
    r.down('DIAL'); run(r, 1100); r.up('DIAL');
    expect(r.on).toBe(false);
  });

  it('wählt Kanäle mit ▲/▼ und 16/C', () => {
    const r = powerOn();
    r.press('CH16'); expect(r.channel).toBe(16);
    r.press('UP'); expect(r.channel).toBe(17);
    r.down('CH16'); run(r, 1100); r.up('CH16');
    expect(r.channel).toBe(9); expect(r.special).toBe('call');
    r.press('SOFT1'); // DISTRESS-Softkey ist Seite 1; CHAN liegt auf Seite 2
    r.popToMain();
    r.press('RIGHT');
    r.press('SOFT1'); // CHAN
    expect(r.special).toBe(null);
  });

  it('Sendeleistung: 15 und 17 nur 1 W, Kanal 70 sendet nicht', () => {
    const r = powerOn();
    r.setChannel(15); expect(view(r).power).toBe('1W');
    r.setChannel(6); expect(view(r).power).toBe('25W');
    r.press('HILO'); expect(view(r).power).toBe('1W');
    r.setChannel(70); r.down('PTT'); expect(r.tx).toBe(false);
    r.setChannel(6); r.down('PTT'); expect(r.tx).toBe(true); r.up('PTT');
  });

  it('Lautstärke und Squelch über DIAL', () => {
    const r = powerOn();
    r.rotate(1); expect(r.settings.volume).toBe(13);
    r.press('DIAL'); r.rotate(-1); r.rotate(-1); expect(r.settings.squelch).toBe(2);
    expect(r.busy).toBe(true); // Rauschen offen
    r.rotate(1); expect(r.busy).toBe(false);
  });

  it('Dual Watch wechselt bei Signal auf 16', () => {
    const r = powerOn();
    r.setChannel(6);
    r.press('RIGHT'); r.press('RIGHT'); // Seite 3? -> zurück zu Seite 1 (3 Seiten)
    r.main.softPage = 0; r.press('SOFT4'); // DW/TW
    expect(r.watch).toBe('DW');
    r.sim.signals.set(16, 7);
    expect(r.rxChannel()).toBe(16);
    r.sim.signals.delete(16);
    expect(r.rxChannel()).toBe(6);
  });

  it('Scan stoppt bei Signal', () => {
    const r = powerOn();
    r.setChannel(1); r.main.softPage = 0; r.press('SOFT3');
    expect(r.scan).toBe('normal');
    r.sim.signals.set(5, 8);
    run(r, 5000);
    expect(r.scanCh).toBe(5);
    expect(r.busy).toBe(true);
  });
});

describe('DSC', () => {
  it('Notruf: 3 s halten, Ack, Kanal 16', () => {
    const r = powerOn();
    r.setChannel(6);
    r.coverOpen = true;
    r.down('DISTRESS'); run(r, 1000); r.up('DISTRESS'); run(r, 100);
    expect(view(r).kind).toBe('main'); // zu früh losgelassen
    r.down('DISTRESS'); run(r, 3100);
    r.up('DISTRESS');
    run(r, 2100);
    expect(r.events.some((e) => e.type === 'distress-sent')).toBe(true);
    expect(view(r).lines[0]).toBe('Waiting for ACK');
    run(r, 7000);
    expect(view(r).title).toBe('RCVD DISTRESS ACK');
    expect(r.channel).toBe(16);
    r.press('SOFT4');
    expect(view(r).lines[0]).toBe('ACK received');
    r.press('SOFT1');
    expect(view(r).kind).toBe('main');
  });

  it('Notruf ohne angehobene Abdeckung wird nicht ausgelöst', () => {
    const r = powerOn();
    r.down('DISTRESS'); run(r, 3500); r.up('DISTRESS');
    expect(r.events.some((e) => e.type === 'distress-sent')).toBe(false);
  });

  it('Einzelruf: Adresse, Kanal, Able to comply', () => {
    const r = powerOn();
    r.main.softPage = 0; r.press('SOFT2'); // OTHER DSC
    expect(view(r).title).toBe('OTHER DSC');
    r.press('SOFT4'); // CALL
    run(r, 2100);
    expect(r.events.find((e) => e.type === 'call-sent')).toMatchObject({ kind: 'Individual', ch: 8, name: 'STATION 1' });
    run(r, 3100);
    expect(view(r).title).toBe('RCVD INDIV ACK');
    r.press('SOFT4');
    expect(r.channel).toBe(8);
  });
});
