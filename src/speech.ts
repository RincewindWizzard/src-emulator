/** Spracheingabe (Web Speech API) und Sprachausgabe für den Prüfungsmodus */

interface RecResult { isFinal: boolean; 0: { transcript: string } }
interface RecEvent { resultIndex: number; results: ArrayLike<RecResult> }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: RecEvent) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
}

export const recognitionSupported = (): boolean => !!(window.SpeechRecognition ?? (window as any).webkitSpeechRecognition);
export const ttsSupported = (): boolean => 'speechSynthesis' in window;

/**
 * Dauerhaft laufende Erkennung; Ergebnisse werden mit Zeitstempel gesammelt.
 * Die Zuordnung zu einer Sendung (PTT gedrückt) übernimmt der Aufrufer über `since()`.
 */
export class Mic {
  private rec: Recognition | null = null;
  private active = false;
  private finals: { t: number; text: string }[] = [];
  private interim = '';
  error = '';
  onText: (live: string) => void = () => {};

  start(lang: string): boolean {
    const Ctor = (window.SpeechRecognition ?? (window as any).webkitSpeechRecognition) as (new () => Recognition) | undefined;
    if (!Ctor) return false;
    this.active = true;
    const rec = (this.rec = new Ctor());
    rec.lang = lang; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) this.finals.push({ t: performance.now(), text: res[0].transcript });
        else interim += res[0].transcript;
      }
      this.interim = interim;
      this.onText(interim);
    };
    rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.error = 'Mikrofonzugriff nicht erlaubt.'; this.active = false; } };
    rec.onend = () => { if (this.active) { try { rec.start(); } catch { /* läuft bereits */ } } };
    try { rec.start(); } catch { return false; }
    return true;
  }

  stop(): void { this.active = false; try { this.rec?.abort(); } catch { /* egal */ } this.rec = null; }

  /** Alles, was seit `t0` (performance.now()) erkannt wurde, inkl. noch nicht finalem Text */
  since(t0: number): string {
    return [...this.finals.filter((f) => f.t >= t0).map((f) => f.text), this.interim].join(' ').trim();
  }
  clearInterim(): void { this.interim = ''; }
}

export function speak(text: string, done: () => void): void {
  if (!ttsSupported()) { setTimeout(done, Math.min(8000, text.length * 55)); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE'; u.rate = 0.95;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('de'));
  if (voice) u.voice = voice;
  u.onend = () => done(); u.onerror = () => done();
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

declare global {
  interface Window { SpeechRecognition?: unknown }
}
