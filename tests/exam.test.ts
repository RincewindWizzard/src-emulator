import { describe, expect, it } from 'vitest';
import { analyzeContent, makeScenario, Exam } from '../src/exam';
import { Radio } from '../src/radio';

const sc = { ...makeScenario('211000001', () => 0), persons: 4 }; // Seeadler / DJAB / Feuer

describe('Auswertung der Notmeldung', () => {
  const full = `Mayday Mayday Mayday, hier ist Seeadler Seeadler Seeadler, Delta Juliett Alfa Bravo, MMSI zwei eins eins null null null null null eins.
    Mayday Seeadler, Delta Juliett Alfa Bravo, meine Position 54 Grad 11 Minuten Nord 007 Grad 54 Minuten Ost,
    Feuer im Maschinenraum, ich brauche sofortige Hilfe, vier Personen an Bord, Segelyacht 11 Meter, Rettungsinsel klar, Kommen`;
  it('erkennt eine vollständige Meldung', () => {
    const c = analyzeContent(full, sc);
    expect(c).toMatchObject({ mayday: 4, hierIst: true, callsign: true, mmsi: true, position: true, nature: true, help: true, persons: true, extra: true, over: true, secondMayday: true });
    expect(c.shipCount).toBe(4);
  });
  it('erkennt fehlende Angaben', () => {
    const c = analyzeContent('Mayday Mayday Mayday hier ist Seeadler', sc);
    expect(c).toMatchObject({ mayday: 3, shipCount: 1, position: false, nature: false, persons: false, over: false });
  });
});

describe('Gegenstelle', () => {
  it('fragt fehlende Angaben nach und bestätigt am Ende', () => {
    const r = new Radio();
    const ex = new Exam(r, () => 0);
    ex.start(() => 0);
    ex.sc.persons = 4;
    ex.tx.push({ text: 'Mayday Mayday Mayday hier ist Seeadler', ch: 16, power: 'HI', noise: false, volume: 10, t: 0, afterDsc: true, afterAck: true });
    expect(ex.replyText()).toContain('Position');
    ex.tx.push({ text: 'meine Position 54 Grad Nord 7 Grad Ost, Feuer an Bord', ch: 16, power: 'HI', noise: false, volume: 10, t: 0, afterDsc: true, afterAck: true });
    expect(ex.replyText()).toContain('Wie viele Personen');
    ex.tx.push({ text: 'vier Personen an Bord, Segelyacht, Rettungsinsel klar', ch: 16, power: 'HI', noise: false, volume: 10, t: 0, afterDsc: true, afterAck: true });
    expect(ex.replyText()).toContain('Alles verstanden');
    expect(ex.closed).toBe(true);
  });
});
