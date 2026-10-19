import type { LcdView, MainView } from './types';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const soft = (labels: string[]): string =>
  `<div class="softbar">${[0, 1, 2, 3].map((i) => `<span class="sk${labels[i] ? '' : ' empty'}">${esc(labels[i] ?? '')}</span>`).join('')}</div>`;

function main(v: MainView): string {
  const icons = [
    `<span class="ic gps ${v.gps === 'blink' ? 'blink' : ''}" title="GPS">◎</span>`,
    v.mail !== 'off' ? `<span class="ic ${v.mail === 'blink' ? 'blink' : ''}" title="DSC-Nachricht">✉</span>` : '',
    v.autoSw ? '<span class="ic" title="Kanalumschaltung">⇄</span>' : '',
  ].join('');
  const status = v.tx ? 'TX' : v.busy ? 'BUSY' : '';
  const left = v.scan || v.watch ? `<div class="dwrow"><span class="inv">${esc(v.scan || v.watch.split(' ')[0])}</span>${v.scan ? '' : '<span class="w16">16</span>'}</div>` : '<div class="dwrow"></div>';
  let html = `
    <div class="m-top"><span class="stat ${status ? 'inv' : ''}">${status || '&nbsp;'}</span><span class="pw">${v.power}</span><span class="grp">${v.group}</span><span class="icons">${icons}</span></div>
    <div class="m-mid">
      <div class="m-left">${left}<div class="pos">${v.pos.map((p) => `<div>${esc(p)}</div>`).join('')}</div></div>
      <div class="m-right">
        <div class="m-mode"><span class="inv">${v.mode}</span></div>
        <div class="m-ch"><span class="big">${v.channel}</span><span class="flags">${v.fav ? '<b>★</b>' : '<b>&nbsp;</b>'}${v.call ? '<b>CALL</b>' : '<b>&nbsp;</b>'}${v.dup ? '<b>DUP</b>' : '<b>&nbsp;</b>'}</span></div>
        ${v.name ? `<div class="chname">${esc(v.name)}</div>` : ''}
      </div>
    </div>${soft(v.soft)}`;
  if (v.overlay) {
    const pct = Math.round((v.overlay.value / v.overlay.max) * 100);
    html += `<div class="overlay"><div class="ol-label">${v.overlay.label}: ${v.overlay.value}</div><div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }
  if (v.closeup) html += `<div class="overlay closeup">${esc(v.closeup)}</div>`;
  if (v.toast) html += `<div class="toast">${esc(v.toast)}</div>`;
  return html;
}

export function renderLcd(v: LcdView): string {
  switch (v.kind) {
    case 'off': return '';
    case 'main': return main(v);
    case 'list':
      return `<div class="title">${esc(v.title)}</div><div class="rows">${v.rows
        .map((r, i) => `<div class="row${i === v.sel ? ' sel' : ''}${r.dim ? ' dim' : ''}"><span>${esc(r.label)}</span><span class="val">${esc(r.value ?? '')}</span></div>`)
        .join('')}</div>${v.hint ? `<div class="hint">${esc(v.hint)}</div>` : ''}${soft(v.soft)}`;
    case 'text':
      return `${v.title ? `<div class="title${v.alert ? ' alert' : ''}">${esc(v.title)}</div>` : ''}<div class="textbody${v.big ? ' big' : ''}">${v.lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>${soft(v.soft)}`;
    case 'entry': {
      const chars = [...v.text].map((c, i) => `<span class="${i === v.cursor ? 'cur' : ''}">${esc(c)}</span>`).join('');
      const keys = v.keys.map((k, i) => `<span class="k${i === v.keySel ? ' sel' : ''}">${esc(k)}</span>`).join('');
      return `<div class="title">${esc(v.title)}</div><div class="entry">${chars}</div><div class="keypad">${keys}</div>${soft(v.soft)}`;
    }
  }
}
