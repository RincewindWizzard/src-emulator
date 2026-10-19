import { AudioEngine } from './audio';
import { receiveCall, type IncomingKind } from './dsc';
import { Exam, type Status } from './exam';
import { renderLcd } from './lcd';
import { Radio } from './radio';
import { Mic, recognitionSupported, speak } from './speech';
import type { Key } from './types';
import { pad2 } from './channels';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const PHONETIC: Record<string, string> = { A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-Ray', Y: 'Yankee', Z: 'Zulu' };
const STORE = 'ic-m330-emulator';

export function start(): void {
  const radio = new Radio();
  const audio = new AudioEngine();
  try { const s = localStorage.getItem(STORE); if (s) radio.restore(s); } catch { /* ohne Speicher */ }
  radio.sound = (s) => audio.play(s);
  (window as unknown as { radio: Radio }).radio = radio;

  buildRadio(radio, audio);
  buildSim(radio);
  buildHelp();
  buildExam(radio);

  const lcd = $<HTMLElement>('#lcd');
  const knob = $<HTMLElement>('.knob');
  let last = '';
  let lastT = performance.now();
  let saveAt = 0;
  setInterval(() => {
    const now = performance.now();
    radio.tick(Math.min(250, now - lastT)); lastT = now;
    audio.update(radio);
    const v = radio.on ? radio.top.view() : ({ kind: 'off' } as const);
    const html = radio.on ? renderLcd(v) : '';
    lcd.classList.toggle('off', !radio.on);
    lcd.style.setProperty('--bl', String(radio.settings.backlight));
    lcd.style.setProperty('--ct', String(radio.settings.contrast));
    if (html !== last) { lcd.innerHTML = html; last = html; }
    knob.style.transform = `rotate(${-135 + (radio.settings.volume / 30) * 270}deg)`;
    $('.tx-led').classList.toggle('on', radio.tx);
    for (const [sel, key, ms] of [['.dial', 'DIAL', 1000], ['.c16', 'CH16', 1000], ['.dbtn', 'DISTRESS', 3000]] as const) {
      const el = $(sel), held = radio.isHeld(key);
      el.classList.toggle('holding', held && radio.heldMs(key) > 150);
      const bar = el.querySelector<HTMLElement>('.holdbar i');
      if (bar) bar.style.width = held ? `${Math.min(100, (radio.heldMs(key) / ms) * 100)}%` : '0';
    }
    if (now - saveAt > 2000) { saveAt = now; try { localStorage.setItem(STORE, radio.snapshot()); } catch { /* egal */ } }
  }, 50);
}

// ---------- Frontplatte und Mikrofon ----------
function buildRadio(r: Radio, audio: AudioEngine): void {
  $('#radio').innerHTML = `
    <div class="grille"></div>
    <div class="logo">ICOM <small>iM330GE · UKW-MARINEFUNKGERÄT</small></div>
    <div class="bezel"><div id="lcd" class="lcd off"></div></div>
    <div class="soft-btns">${[1, 2, 3, 4].map((i) => `<button class="hw" data-key="SOFT${i}" style="left:${19.5 + (i - 1) * 11.1}%" title="Softtaste ${i} (Taste ${i})"></button>`).join('')}</div>
    <div class="dpad">
      <button class="hw" data-key="UP" title="▲ (Pfeil hoch)">▲</button><button class="hw" data-key="LEFT" title="◄ (Pfeil links)">◄</button>
      <button class="hw" data-key="ENT" title="ENT (Enter)">ENT</button><button class="hw" data-key="RIGHT" title="► (Pfeil rechts)">►</button>
      <button class="hw" data-key="DOWN" title="▼ (Pfeil runter)">▼</button>
    </div>
    <button class="hw clr" data-key="CLR" title="CLR (Backspace/Esc)">CLR</button>
    <button class="hw menu" data-key="MENU" title="MENU (M)">MENU</button>
    <button class="hw c16" data-key="CH16" title="16/C – kurz: Kanal 16, 1 s halten: Rufkanal (C)">16/C<span class="holdbar"><i></i></span></button>
    <div class="dial" title="PWR/VOL/SQL – Drehen: Lautstärke · kurz drücken: Lautstärke/SQL-Anzeige · 1 s halten: Ein/Aus">
      <div class="knob"><i></i></div><span class="holdbar"><i></i></span>
      <div class="dial-label">PWR / VOL / SQL (DIAL)</div>
      <div class="dial-btns"><button class="hw" id="dccw" title="Linksdrehen ( [ )">⟲</button><button class="hw" id="dcw" title="Rechtsdrehen ( ] )">⟳</button></div>
    </div>
    <div class="distress"><button class="hw dbtn" data-key="DISTRESS" title="DISTRESS – 3 s halten">DISTRESS<span class="holdbar"><i></i></span></button><div class="cover" id="cover" title="Schutzkappe – klicken zum Anheben">Kappe anheben</div></div>`;
  $('#mic').innerHTML = `
    <div class="mic"><div class="tx-led"></div><div class="mgrille"></div>
      <button class="ptt" data-key="PTT" title="PTT – gedrückt halten zum Senden (Leertaste)">PTT<small>halten</small></button>
      <button class="m-up" data-key="MICUP">▲</button><button class="m-down" data-key="MICDOWN">▼</button>
      <button class="m-hilo" data-key="HILO">HI/LO</button><button class="m-16" data-key="CH16">16/C</button></div>`;

  const bind = (el: HTMLElement, key: Key) => {
    el.addEventListener('pointerdown', (e) => { audio.unlock(); el.setPointerCapture(e.pointerId); el.classList.add('down'); r.down(key); e.preventDefault(); });
    const up = () => { el.classList.remove('down'); r.up(key); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  document.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => bind(el, el.dataset.key as Key));

  // Abdeckung
  const cover = $('#cover');
  cover.addEventListener('click', () => { audio.unlock(); cover.classList.toggle('open'); r.setCover(cover.classList.contains('open')); });

  // DIAL: Klick/Halten, Mausrad, Ziehen
  const dial = $<HTMLElement>('.knob');
  let drag: { a: number; rotated: boolean; acc: number } | null = null;
  const angle = (e: PointerEvent) => { const b = dial.getBoundingClientRect(); return (Math.atan2(e.clientY - b.top - b.height / 2, e.clientX - b.left - b.width / 2) * 180) / Math.PI; };
  dial.addEventListener('pointerdown', (e) => { audio.unlock(); dial.setPointerCapture(e.pointerId); drag = { a: angle(e), rotated: false, acc: 0 }; r.down('DIAL'); });
  dial.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const a = angle(e); let d = a - drag.a; if (d > 180) d -= 360; if (d < -180) d += 360;
    drag.a = a; drag.acc += d;
    while (Math.abs(drag.acc) >= 9) {
      const dir = drag.acc > 0 ? 1 : -1; drag.acc -= dir * 9; r.rotate(dir);
      if (!drag.rotated) { drag.rotated = true; r.cancelHold('DIAL'); }
    }
  });
  const end = () => { if (drag && !drag.rotated) r.up('DIAL'); drag = null; };
  dial.addEventListener('pointerup', end); dial.addEventListener('pointercancel', end);
  dial.parentElement!.addEventListener('wheel', (e) => { e.preventDefault(); r.rotate(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  $('#dcw').addEventListener('click', () => r.rotate(1)); $('#dccw').addEventListener('click', () => r.rotate(-1));

  // Tastatur
  const map: Record<string, Key> = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', Enter: 'ENT', Backspace: 'CLR', Escape: 'CLR', m: 'MENU', M: 'MENU', c: 'CH16', C: 'CH16', ' ': 'PTT', h: 'HILO', H: 'HILO', p: 'DIAL', P: 'DIAL', 1: 'SOFT1', 2: 'SOFT2', 3: 'SOFT3', 4: 'SOFT4' };
  const typing = (e: Event) => ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName);
  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    audio.unlock();
    if (e.key === ']' || e.key === '+') { r.rotate(1); return; }
    if (e.key === '[' || e.key === '-') { r.rotate(-1); return; }
    const k = map[e.key];
    if (!k) return;
    e.preventDefault();
    if (!e.repeat) r.down(k);
  });
  window.addEventListener('keyup', (e) => { if (typing(e)) return; const k = map[e.key]; if (k) r.up(k); });
}

// ---------- Simulator ----------
function buildSim(r: Radio): void {
  const el = $('#sim');
  el.innerHTML = `<summary>Übungsumgebung (Gegenstellen &amp; Funkverkehr)</summary>
    <div class="sim-grid">
      <div class="sim-row"><label>Funkverkehr auf Kanal</label><input id="sg-ch" type="number" min="1" max="88" value="6" /><label>Stärke</label><input id="sg-str" type="number" min="1" max="9" value="7" /><button class="btn small" id="sg-add">Signal starten</button></div>
      <div class="sim-row" id="sg-list"></div>
      <div class="sim-row"><label>Eingehender DSC-Ruf:</label>
        <button class="btn small" data-rx="distress">Notruf</button><button class="btn small" data-rx="individual">Einzelruf</button><button class="btn small" data-rx="group">Gruppenruf</button>
        <button class="btn small" data-rx="all-urgency">Allschiffe Dringlichk.</button><button class="btn small" data-rx="all-safety">Allschiffe Sicherheit</button></div>
      <div class="sim-row"><label>Angerufene Station antwortet</label><select id="sg-reply"><option value="able">Able to comply</option><option value="unable">Unable to comply</option><option value="none">gar nicht</option></select></div>
      <div class="sim-row"><label><input type="checkbox" id="sg-coast" checked /> Küstenfunkstelle quittiert Notalarm nach</label><input id="sg-delay" type="number" min="1" max="60" value="6" /><label>s</label></div>
      <div class="sim-row"><label><input type="checkbox" id="sg-gps" checked /> GPS-Empfang vorhanden</label></div>
      <div class="sim-row"><button class="btn small" id="sg-reset">Werkseinstellungen / Erstinbetriebnahme (MMSI-Eingabe)</button></div>
    </div>`;
  const list = $('#sg-list');
  const drawSignals = () => {
    list.innerHTML = [...r.sim.signals].map(([c, s]) => `<span class="btn small" data-rm="${c}">Kanal ${pad2(c)} (${s}) ✕</span>`).join('');
  };
  $('#sg-add').addEventListener('click', () => {
    r.sim.signals.set(Number($<HTMLInputElement>('#sg-ch').value), Number($<HTMLInputElement>('#sg-str').value)); drawSignals();
  });
  list.addEventListener('click', (e) => { const c = (e.target as HTMLElement).dataset.rm; if (c) { r.sim.signals.delete(Number(c)); drawSignals(); } });
  el.querySelectorAll<HTMLElement>('[data-rx]').forEach((b) => b.addEventListener('click', () => receiveCall(r, b.dataset.rx as IncomingKind)));
  $('#sg-reply').addEventListener('change', (e) => { r.sim.stationReply = (e.target as HTMLSelectElement).value as 'able'; });
  $('#sg-coast').addEventListener('change', (e) => { r.sim.coastAck = (e.target as HTMLInputElement).checked; });
  $('#sg-delay').addEventListener('change', (e) => { r.sim.coastAckDelayMs = Number((e.target as HTMLInputElement).value) * 1000; });
  $('#sg-gps').addEventListener('change', (e) => { r.sim.gps = (e.target as HTMLInputElement).checked; });
  $('#sg-reset').addEventListener('click', () => { r.factoryReset(); $('#cover').classList.remove('open'); });
}

function buildHelp(): void {
  $('#help').innerHTML = `<summary>Tastenbelegung &amp; Notrufverfahren</summary>
    <div class="helptxt">
      <h2>Tastatur</h2>
      <div class="keys"><span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd></span><span>◄ ► ▲ ▼</span><span><kbd>Enter</kbd></span><span>ENT</span><span><kbd>Esc</kbd> / <kbd>⌫</kbd></span><span>CLR</span>
      <span><kbd>M</kbd></span><span>MENU</span><span><kbd>1</kbd>–<kbd>4</kbd></span><span>Softtasten</span><span><kbd>C</kbd></span><span>16/C (kurz)</span><span><kbd>H</kbd></span><span>HI/LO</span>
      <span><kbd>Leertaste</kbd></span><span>PTT (halten)</span><span><kbd>[</kbd> <kbd>]</kbd></span><span>DIAL drehen</span><span><kbd>P</kbd></span><span>DIAL drücken</span></div>
      <h2 style="margin-top:12px">Notruf auf Kanal 16 (Handbuch S. 2)</h2>
      <ol><li>„MAYDAY MAYDAY MAYDAY“</li><li>„HIER IST …“ (Schiffsname, 3×)</li><li>Rufzeichen / Schiffskennung (und 9-stellige MMSI)</li><li>„MEINE POSITION IST …“</li><li>Grund des Notalarms (z. B. Feuer an Bord)</li><li>Weitere Angaben, die die Rettung erleichtern</li></ol>
      <h2>DSC-Notalarm (Kanal 70)</h2>
      <ol><li>Schutzkappe anheben, [DISTRESS] 3 s halten (3 kurze Töne + 1 langer Ton)</li><li>Quittung der Küstenfunkstelle abwarten → Kanal 16 wird gewählt</li><li>Notmeldung per Sprechfunk: [PTT] halten, ca. 1 s warten, dann sprechen</li></ol>
    </div>`;
}

// ---------- Prüfungsmodus ----------
function buildExam(r: Radio): void {
  const el = $('#exam');
  const exam = new Exam(r);
  const mic = new Mic();
  const canRec = recognitionSupported();
  let textMode = !canRec;
  let t0 = 0;
  let sigTimer = 0;

  exam.speak = (text, done) => {
    r.sim.signals.set(16, 8);
    window.clearTimeout(sigTimer);
    speak(text, () => { sigTimer = window.setTimeout(() => r.sim.signals.delete(16), 400); done(); });
  };

  const spelled = () => [...exam.sc.callsign].map((c) => PHONETIC[c]).join(' ');
  const draw = () => {
    const sc = exam.sc;
    const live = el.querySelector('#ex-live')?.textContent ?? '';
    const taOld = el.querySelector<HTMLTextAreaElement>('#ex-ta')?.value ?? '';
    el.innerHTML = `<h2>Prüfungsmodus: Notmeldung</h2>` + (exam.running
      ? `<dl class="scenario"><dt>Ihr Schiff</dt><dd><b>${sc.ship}</b> – ${sc.extra}</dd><dt>Rufzeichen / MMSI</dt><dd>${sc.callsign} (${spelled()}) · ${sc.mmsi}</dd>
          <dt>Position</dt><dd>${sc.position}</dd><dt>Lage</dt><dd>${sc.natureText}</dd><dt>Personen an Bord</dt><dd>${sc.persons}</dd></dl>
        <p style="margin:6px 0;color:var(--muted);font-size:13px">Setzen Sie am Gerät den DSC-Notalarm ab und sprechen Sie danach die Notmeldung auf Kanal 16 (PTT halten, ca. 1 s warten, dann sprechen).</p>
        <div class="log" id="ex-log">${exam.lines.map((l) => `<div class="msg ${l.who}"><b>${l.who === 'me' ? 'Sie' : l.who === 'kfs' ? 'Bremen Rescue Radio' : 'Hinweis'}</b>${l.text}</div>`).join('')}</div>
        <div class="live" id="ex-live">${live}</div>
        <div class="sim-row"><label><input type="checkbox" id="ex-text" ${textMode ? 'checked' : ''} ${canRec ? '' : 'disabled'} /> Texteingabe statt Mikrofon</label></div>
        ${textMode ? `<textarea id="ex-ta" placeholder="Meldung hier eintippen, dann PTT halten und loslassen (der Text wird beim Loslassen gesendet)"></textarea>` : `<div style="font-size:12.5px;color:var(--muted)">${mic.error || 'Mikrofon aktiv – Spracherkennung läuft (Chrome/Edge).'}</div>`}
        <div class="sim-row" style="margin-top:8px"><button class="btn primary" id="ex-end">Prüfung beenden &amp; Auswertung</button></div>`
      : `<p style="margin:0 0 10px;color:var(--muted)">Sie erhalten ein Notfall-Szenario. Setzen Sie den DSC-Notalarm ab und sprechen Sie die Notmeldung per Mikrofon (Taste PTT halten). Die Küstenfunkstelle antwortet per Sprachausgabe, am Ende gibt es eine Checkliste mit allem, was richtig war und was fehlte.</p>
         <div class="sim-row"><label>Sprache der Erkennung</label><select id="ex-lang"><option value="de-DE">Deutsch</option><option value="en-US">English (MAYDAY wird oft besser erkannt)</option></select></div>
         <div class="sim-row" style="margin-top:8px"><button class="btn primary" id="ex-start">Prüfung starten</button>${canRec ? '' : '<span style="color:var(--warn);font-size:13px">Dieser Browser hat keine Spracherkennung – es wird die Texteingabe genutzt.</span>'}</div>`);
    const ta = el.querySelector<HTMLTextAreaElement>('#ex-ta'); if (ta) ta.value = taOld;
    const log = el.querySelector('#ex-log'); if (log) log.scrollTop = log.scrollHeight;
    el.querySelector('#ex-start')?.addEventListener('click', () => {
      if (!r.on) r.toast('Gerät erst einschalten');
      textMode = !canRec;
      exam.start();
      if (canRec) {
        mic.start((el.querySelector<HTMLSelectElement>('#ex-lang')?.value) ?? 'de-DE');
        mic.onText = (t) => { const l = el.querySelector('#ex-live'); if (l) l.textContent = t ? `🎤 ${t}` : ''; };
      }
      draw();
    });
    el.querySelector('#ex-text')?.addEventListener('change', (e) => { textMode = (e.target as HTMLInputElement).checked; draw(); });
    el.querySelector('#ex-end')?.addEventListener('click', () => { mic.stop(); speechSynthesis?.cancel(); exam.end(); showReport(exam, () => { exam.finished = false; draw(); }); draw(); });
  };
  exam.onChange = draw;

  r.listeners.push((e) => {
    if (!exam.running) return;
    if (e.type === 'ptt-start') { t0 = performance.now() - 400; mic.clearInterim(); }
    if (e.type === 'ptt-end') {
      const from = t0;
      const grab = () => {
        const ta = el.querySelector<HTMLTextAreaElement>('#ex-ta');
        const text = textMode ? ta?.value ?? '' : mic.since(from);
        if (ta) ta.value = '';
        mic.clearInterim();
        const l = el.querySelector('#ex-live'); if (l) l.textContent = '';
        exam.submit(text);
      };
      if (textMode) grab(); else window.setTimeout(grab, 1400);
    }
  });
  draw();
}

function showReport(exam: Exam, onClose: () => void): void {
  const dlg = $<HTMLDialogElement>('#report');
  const icon: Record<Status, string> = { ok: '✓', miss: '✗', warn: '!' };
  const draw = () => {
    const { ok, total } = exam.score();
    dlg.innerHTML = `<h2 style="margin:0">Auswertung</h2><div class="score">${ok} / ${total} Punkte</div>
      <p style="color:var(--muted);margin:2px 0 6px;font-size:13px">✓ erledigt · ! unvollständig/verbesserbar · ✗ vergessen. Die Spracherkennung irrt gelegentlich: Zeile anklicken, um den Status manuell umzuschalten.</p>
      ${exam.checklist().map((s) => `<div class="sec">${s.section}</div>${s.items.map((i) => `<div class="ci ${i.status}" data-id="${i.id}" data-st="${i.status}"><span class="ic">${icon[i.status]}</span><span>${i.text}${i.note ? `<small>${i.note}</small>` : ''}</span></div>`).join('')}`).join('')}
      <div class="sec">Ihr Funkverkehr</div><div class="transcript">${exam.lines.filter((l) => l.who !== 'sys').map((l) => `${l.who === 'me' ? 'Sie' : 'Bremen Rescue Radio'}: ${l.text}`).join('\n\n') || '(keine Sendung)'}</div>
      <div class="sim-row" style="margin-top:14px"><button class="btn primary" id="rp-close">Schließen / neue Prüfung</button></div>`;
    dlg.querySelectorAll<HTMLElement>('.ci').forEach((row) => row.addEventListener('click', () => {
      exam.overrides.set(row.dataset.id!, row.dataset.st === 'ok' ? 'miss' : 'ok'); draw();
    }));
    dlg.querySelector('#rp-close')?.addEventListener('click', () => { dlg.close(); onClose(); });
  };
  draw();
  dlg.showModal();
}
