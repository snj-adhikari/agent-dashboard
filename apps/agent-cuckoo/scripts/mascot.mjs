#!/usr/bin/env node
/**
 * Draws the agent-cuckoo mascot (original art) into assets/mascot as SVG, plus the app icon.
 * PNG @1x/@2x export runs when @resvg/resvg-js resolves: `npm i --no-save @resvg/resvg-js && node scripts/mascot.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'mascot');
const C = {
  body: '#c98a4b', bodyDark: '#a4622c', wing: '#8c5226', belly: '#f8e7c6', beak: '#f59e0b', beakDark: '#d97706',
  eye: '#ffffff', pupil: '#1d1a2b', cheek: '#f472b6', flag: '#7c3aed', pole: '#e5e7eb', ink: '#1d1a2b',
  wood: '#6b4226', woodLight: '#8a5a33', door: '#2b1a0e', sweat: '#7dd3fc', zz: '#c4b5fd', alarm: '#ef4444',
};

const defs = `<defs>
  <radialGradient id="cbody" cx="0.38" cy="0.3" r="0.8"><stop offset="0" stop-color="#e0a565"/><stop offset="0.65" stop-color="${C.body}"/><stop offset="1" stop-color="${C.bodyDark}"/></radialGradient>
  <radialGradient id="cbelly" cx="0.5" cy="0.35" r="0.7"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="${C.belly}"/></radialGradient>
</defs>`;

const eyes = {
  open: (dx = 0, dy = 0, r = 7) => [50, 78].map((x) => `<ellipse cx="${x}" cy="60" rx="11" ry="12.5" fill="${C.eye}"/><circle cx="${x + dx}" cy="${61 + dy}" r="${r}" fill="${C.pupil}"/><circle cx="${x + dx + 2.6}" cy="${57.5 + dy}" r="2.6" fill="#fff"/>`).join(''),
  closed: () => [50, 78].map((x) => `<path d="M${x - 9} 61 Q${x} 68 ${x + 9} 61" fill="none" stroke="${C.ink}" stroke-width="3.4" stroke-linecap="round"/>`).join(''),
  happy: () => [50, 78].map((x) => `<path d="M${x - 9} 63 Q${x} 52 ${x + 9} 63" fill="none" stroke="${C.ink}" stroke-width="3.6" stroke-linecap="round"/>`).join(''),
  wide: (dx = 0, dy = 0) => [50, 78].map((x) => `<ellipse cx="${x}" cy="59" rx="12" ry="14" fill="${C.eye}"/><circle cx="${x + dx}" cy="${59 + dy}" r="4" fill="${C.pupil}"/><circle cx="${x + dx + 1.8}" cy="${56.5 + dy}" r="1.6" fill="#fff"/>`).join(''),
  spiral: () => [50, 78].map((x) => `<ellipse cx="${x}" cy="60" rx="11" ry="12.5" fill="${C.eye}"/><path d="M${x} 60 a1.5 1.5 0 1 1 3 0 a3.5 3.5 0 1 1 -7 0 a5.5 5.5 0 1 1 11 0 a7.5 7.5 0 1 1 -15 0" fill="none" stroke="${C.pupil}" stroke-width="2" stroke-linecap="round"/>`).join(''),
  droopy: () => [50, 78].map((x) => `<path d="M${x - 9} 62 Q${x} 66 ${x + 9} 62" fill="none" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/><path d="M${x - 10} 58 L${x + 10} 58" stroke="${C.bodyDark}" stroke-width="3" stroke-linecap="round"/>`).join(''),
};

const beak = {
  closed: `<path d="M57 70 Q64 66 71 70 Q64 80 57 70 Z" fill="${C.beak}" stroke="${C.beakDark}" stroke-width="1.5" stroke-linejoin="round"/>`,
  open: `<path d="M57 69 Q64 65 71 69 L64 74 Z" fill="${C.beak}" stroke="${C.beakDark}" stroke-width="1.5" stroke-linejoin="round"/><path d="M58.5 75 L64 74 L69.5 75 Q64 84 58.5 75 Z" fill="${C.beakDark}"/>`,
  smile: `<path d="M57 69 Q64 65 71 69 Q64 75 57 69 Z" fill="${C.beak}" stroke="${C.beakDark}" stroke-width="1.5"/><path d="M58 73 Q64 82 70 73 Q64 76 58 73 Z" fill="#f43f5e"/>`,
};

const flag = (raised) => {
  const t = raised ? 'rotate(-14 100 92)' : '';
  return `<g transform="${t}"><rect x="98.5" y="44" width="3.4" height="50" rx="1.7" fill="${C.pole}"/><path d="M101.5 45 L121 51.5 L101.5 59 Z" fill="${C.flag}" stroke="#5b21b6" stroke-width="1.2" stroke-linejoin="round"/><circle cx="100.2" cy="43.5" r="2.6" fill="#fbbf24"/></g>`;
};

const star = (x, y, r = 5, c = '#fde047') => `<path d="M${x} ${y - r} L${x + r * 0.3} ${y - r * 0.3} L${x + r} ${y} L${x + r * 0.3} ${y + r * 0.3} L${x} ${y + r} L${x - r * 0.3} ${y + r * 0.3} L${x - r} ${y} L${x - r * 0.3} ${y - r * 0.3} Z" fill="${c}"/>`;
const note = (x, y, c) => `<ellipse cx="${x}" cy="${y}" rx="4.2" ry="3.2" fill="${c}" transform="rotate(-20 ${x} ${y})"/><path d="M${x + 3.6} ${y - 1} L${x + 3.6} ${y - 16} Q${x + 9} ${y - 14} ${x + 10} ${y - 9}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>`;

/** One bird; `mood` picks eyes, beak, wings and extras. */
function bird(mood) {
  const wingUp = ['happy', 'alarmed', 'wave', 'celebrate', 'dance', 'proud', 'surprised'].includes(mood);
  const look = { working: eyes.open(2, 3, 6.5), waiting: eyes.open(0, -3), alarmed: eyes.open(0, 0, 4.2), idle: eyes.open(), thinking: eyes.open(-3, -4, 6), listening: eyes.wide(3, -2), surprised: eyes.wide(), box: eyes.wide(0, -3), dizzy: eyes.spiral() }[mood];
  const face = look ?? { blink: eyes.closed(), happy: eyes.happy(), sleepy: eyes.droopy(), wave: eyes.happy(), celebrate: eyes.happy(), dance: eyes.happy(), proud: eyes.happy() }[mood];
  const mouth = ['happy', 'wave', 'celebrate', 'dance', 'proud'].includes(mood) ? beak.smile : ['alarmed', 'waiting', 'surprised', 'dizzy'].includes(mood) ? beak.open : beak.closed;
  const crest = mood === 'alarmed' || mood === 'surprised'
    ? `<path d="M56 30 L52 12 L62 26 L64 8 L68 26 L77 13 L72 31 Z" fill="${C.bodyDark}"/>`
    : `<path d="M58 31 Q55 18 62 14 Q62 24 66 27 Q70 17 78 17 Q72 25 72 32 Z" fill="${C.bodyDark}"/>`;
  const leftWing = wingUp
    ? `<path d="M30 74 Q14 58 18 44 Q30 52 36 68 Z" fill="${C.wing}"/>`
    : `<path d="M28 70 Q18 86 30 100 Q38 90 38 76 Z" fill="${C.wing}"/>`;
  const rightWing = `<path d="M100 72 Q108 84 100 98 Q91 90 90 78 Z" fill="${C.wing}"/>`;
  const extras = {
    working: `<path d="M94 40 Q99 48 94 52 Q89 48 94 40 Z" fill="${C.sweat}"/>`,
    sleepy: `<text x="88" y="34" font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="700" font-size="16" fill="${C.zz}">z</text><text x="100" y="22" font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="700" font-size="12" fill="${C.zz}">z</text>`,
    happy: `<path d="M16 26 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 Z" fill="#fde047"/><path d="M110 18 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z" fill="#fde047"/>`,
    wave: `<path d="M12 40 Q8 46 12 52 M6 36 Q0 46 6 56" fill="none" stroke="#fde68a" stroke-width="2.6" stroke-linecap="round"/>`,
    thinking: `<circle cx="102" cy="30" r="4" fill="#e5e7eb"/><circle cx="112" cy="18" r="6" fill="#e5e7eb"/><circle cx="106" cy="18" r="1.6" fill="${C.ink}"/><circle cx="112" cy="18" r="1.6" fill="${C.ink}"/><circle cx="118" cy="18" r="1.6" fill="${C.ink}"/>`,
    celebrate: `<path d="M50 6 L62 30 L38 30 Z" fill="${C.flag}"/><circle cx="50" cy="5" r="3.5" fill="#fde047"/>${[[14, 22, '#f43f5e'], [24, 10, '#22c55e'], [104, 14, '#38bdf8'], [116, 30, '#fde047'], [10, 44, '#a78bfa'], [118, 48, '#f97316']].map(([x, y, c]) => `<rect x="${x}" y="${y}" width="6" height="3.5" rx="1.2" fill="${c}" transform="rotate(${(x * 7) % 60 - 30} ${x} ${y})"/>`).join('')}`,
    listening: `<path d="M20 50 Q15 58 20 66 M13 44 Q5 58 13 72" fill="none" stroke="#67e8f9" stroke-width="2.6" stroke-linecap="round"/>`,
    surprised: `<path d="M14 50 L4 46 M14 58 L3 58 M16 66 L6 70 M114 50 L124 46 M114 58 L125 58 M112 66 L122 70" stroke="#fde68a" stroke-width="2.6" stroke-linecap="round"/>`,
    dizzy: `${star(24, 26, 5, '#fde047')}${star(64, 6, 4.5, '#f9a8d4')}${star(104, 24, 5, '#fde047')}<path d="M24 26 Q64 -2 104 24" fill="none" stroke="#f9a8d4" stroke-width="1.6" stroke-dasharray="3 4" opacity="0.8"/>`,
    proud: `${star(16, 30, 7)}${star(112, 22, 6)}${star(22, 8, 4)}${star(118, 46, 4)}${star(104, 4, 3.5)}`,
    alarmed: `<rect x="17" y="16" width="7" height="20" rx="3.5" fill="${C.alarm}"/><circle cx="20.5" cy="42" r="4" fill="${C.alarm}"/>`,
  }[mood] ?? '';
  return `<g>
  <path d="M26 92 Q8 96 6 108 Q18 104 30 102 Z" fill="${C.wing}"/>
  <path d="M54 110 L50 120 M54 110 L58 120 M74 110 L70 120 M74 110 L78 120" stroke="${C.beakDark}" stroke-width="3.2" stroke-linecap="round"/>
  ${crest}
  <ellipse cx="64" cy="72" rx="40" ry="41" fill="url(#cbody)"/>
  <ellipse cx="64" cy="90" rx="25" ry="20" fill="url(#cbelly)"/>
  ${leftWing}${rightWing}
  <ellipse cx="38" cy="75" rx="6.5" ry="4" fill="${C.cheek}" opacity="0.45"/><ellipse cx="90" cy="75" rx="6.5" ry="4" fill="${C.cheek}" opacity="0.45"/>
  ${face}${mouth}
  ${flag(wingUp)}
  ${extras}
</g>`;
}

/** Bird peeking out of a cuckoo-clock door, clipped so the lower body stays inside. */
function clockPeek(withBird = true) {
  return `<clipPath id="door"><path d="M34 128 L34 64 Q64 34 94 64 L94 128 Z"/></clipPath>
  <path d="M64 6 L124 54 L110 54 L110 128 L18 128 L18 54 L4 54 Z" fill="${C.woodLight}"/>
  <path d="M64 6 L124 54 L4 54 Z" fill="${C.wood}"/>
  <path d="M34 128 L34 64 Q64 34 94 64 L94 128 Z" fill="${C.door}"/>
  ${withBird ? `<g clip-path="url(#door)"><g transform="translate(16 46) scale(0.75)">${bird('waiting')}</g></g>` : ''}
  <path d="M34 128 L34 64 Q64 34 94 64 L94 128" fill="none" stroke="${C.wood}" stroke-width="4"/>`;
}

/** Bird hidden in a cardboard box, only the head above the rim (upload morph). */
function boxPose() {
  return `${bird('box')}
  <path d="M22 70 L4 56 L30 58 Z M106 70 L124 56 L98 58 Z" fill="#c08a52" stroke="#8a5a33" stroke-width="2" stroke-linejoin="round"/>
  <rect x="22" y="70" width="84" height="52" rx="4" fill="#d9a066" stroke="#8a5a33" stroke-width="2.4"/>
  <path d="M22 80 L106 80" stroke="#b07a44" stroke-width="2"/>
  <rect x="56" y="70" width="16" height="22" fill="#e9c08f"/>
  <path d="M46 102 L82 102 M50 110 L78 110" stroke="#8a5a33" stroke-width="2.4" stroke-linecap="round" opacity="0.6"/>`;
}

const tilt = (deg, cx, cy, body) => `<g transform="rotate(${deg} ${cx} ${cy})">${body}</g>`;

/**
 * Outfit layers share the poses' 128x128 frame and anchor to the head box (x 24-104, y 0-72, eyes on y 60, crest top y 8).
 * A renderer overlays the layer with the same transform as the pose underneath.
 */
const OUTFITS = {
  none: '',
  'party-hat': `<g transform="rotate(-12 64 34)"><path d="M48 36 L64 2 L80 36 Z" fill="#38bdf8"/><path d="M53 26 L75 26 M58 15 L70 15" stroke="#fde047" stroke-width="3.4"/><path d="M48 36 Q64 41 80 36" fill="none" stroke="#0284c7" stroke-width="2.4"/><circle cx="64" cy="3" r="4.5" fill="#f472b6"/></g>`,
  beanie: `<path d="M27 46 C28 6 100 6 101 46 Z" fill="#ef4444"/><path d="M44 16 L44 44 M64 10 L64 44 M84 16 L84 44" stroke="#dc2626" stroke-width="2.6"/><rect x="24" y="38" width="80" height="11" rx="5.5" fill="#fca5a5"/><circle cx="64" cy="10" r="7" fill="#fef2f2"/>`,
  crown: `<path d="M40 38 L38 14 L51 26 L64 8 L77 26 L90 14 L88 38 Z" fill="#fbbf24" stroke="#d97706" stroke-width="2" stroke-linejoin="round"/><circle cx="64" cy="29" r="3.6" fill="#ef4444"/><circle cx="49" cy="32" r="2.6" fill="#38bdf8"/><circle cx="79" cy="32" r="2.6" fill="#22c55e"/>`,
  'witch-hat': `<path d="M46 36 L68 4 Q78 0 88 10 Q80 8 76 14 L84 36 Z" fill="#4c1d95"/><rect x="47" y="28" width="37" height="7" fill="#f97316"/><ellipse cx="64" cy="37" rx="40" ry="6.5" fill="#3b0764"/>`,
  'santa-hat': `<path d="M30 40 C34 6 82 2 98 18 Q110 28 108 40 Z" fill="#dc2626"/><path d="M98 18 Q112 26 110 40" fill="none" stroke="#b91c1c" stroke-width="2"/><circle cx="109" cy="42" r="7" fill="#f8fafc"/><rect x="26" y="34" width="76" height="12" rx="6" fill="#f8fafc"/>`,
  'bunny-ears': `<g transform="rotate(-12 50 36)"><ellipse cx="50" cy="19" rx="8" ry="18" fill="#f8fafc" stroke="#e5e7eb" stroke-width="1.6"/><ellipse cx="50" cy="20" rx="4" ry="12" fill="#f9a8d4"/></g><g transform="rotate(14 80 36)"><ellipse cx="80" cy="19" rx="8" ry="18" fill="#f8fafc" stroke="#e5e7eb" stroke-width="1.6"/><ellipse cx="80" cy="20" rx="4" ry="12" fill="#f9a8d4"/></g><rect x="40" y="32" width="50" height="6" rx="3" fill="#f472b6"/>`,
  bow: `<g transform="rotate(18 90 30)"><path d="M90 30 L74 20 Q70 30 74 40 Z M90 30 L106 20 Q110 30 106 40 Z" fill="#f472b6" stroke="#db2777" stroke-width="1.8" stroke-linejoin="round"/><circle cx="90" cy="30" r="4.6" fill="#db2777"/></g>`,
  sunglasses: `<path d="M36 52 L92 52" stroke="${C.ink}" stroke-width="3"/><rect x="36" y="51" width="27" height="17" rx="7" fill="${C.ink}"/><rect x="65" y="51" width="27" height="17" rx="7" fill="${C.ink}"/><path d="M40 55 L48 55 M69 55 L77 55" stroke="#64748b" stroke-width="2.4" stroke-linecap="round"/><path d="M36 55 L26 52 M92 55 L102 52" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/>`,
  'round-glasses': `<circle cx="50" cy="60" r="13" fill="#bae6fd" fill-opacity="0.18" stroke="#78350f" stroke-width="2.6"/><circle cx="78" cy="60" r="13" fill="#bae6fd" fill-opacity="0.18" stroke="#78350f" stroke-width="2.6"/><path d="M62 58 Q64 55 66 58 M37 58 L27 55 M91 58 L101 55" fill="none" stroke="#78350f" stroke-width="2.6" stroke-linecap="round"/>`,
  scarf: `<path d="M28 84 Q64 100 100 84 L101 95 Q64 111 27 95 Z" fill="#22c55e"/><path d="M40 90 L40 101 M56 93 L56 105 M72 93 L72 105 M88 90 L88 101" stroke="#15803d" stroke-width="2.4"/><path d="M80 96 L76 118 L90 118 L92 96 Z" fill="#16a34a"/><path d="M77 118 L77 122 M83 118 L83 122 M89 118 L89 122" stroke="#16a34a" stroke-width="2" stroke-linecap="round"/>`,
  pumpkin: `<path d="M66 12 Q68 4 74 2" fill="none" stroke="#3f6212" stroke-width="3" stroke-linecap="round"/><ellipse cx="64" cy="26" rx="22" ry="15" fill="#f97316"/><ellipse cx="64" cy="26" rx="10" ry="15" fill="#fb923c"/><path d="M50 14 Q44 26 50 39 M78 14 Q84 26 78 39" fill="none" stroke="#ea580c" stroke-width="1.8"/><path d="M68 12 Q78 8 82 14 Q74 16 68 12 Z" fill="#65a30d"/>`,
};

const svg = (body, size = 128) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}">\n${defs}\n${body}\n</svg>\n`;

const MOODS = ['idle', 'blink', 'working', 'happy', 'sleepy', 'alarmed', 'wave', 'thinking', 'celebrate'];
const files = Object.fromEntries(MOODS.map((m) => [`cuckoo-${m}`, svg(bird(m))]));
files['cuckoo-waiting'] = svg(clockPeek());
files['cuckoo-clock'] = svg(clockPeek(false));
files['cuckoo-bird'] = svg(bird('waiting'));
files['cuckoo-dance-a'] = svg(`${tilt(-9, 64, 120, bird('dance'))}${note(14, 40, '#a78bfa')}${note(22, 18, '#67e8f9')}`);
files['cuckoo-dance-b'] = svg(`${tilt(9, 64, 120, bird('dance'))}${note(104, 40, '#67e8f9')}${note(112, 18, '#a78bfa')}`);
files['cuckoo-listening'] = svg(tilt(-12, 64, 72, bird('listening')));
files['cuckoo-box'] = svg(boxPose());
files['cuckoo-dizzy'] = svg(tilt(8, 64, 72, bird('dizzy')));
files['cuckoo-proud'] = svg(bird('proud'));
files['cuckoo-surprised'] = svg(bird('surprised'));
for (const [id, layer] of Object.entries(OUTFITS)) files[`outfit-${id}`] = svg(layer);

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
${defs}
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2350"/><stop offset="1" stop-color="#120f24"/></linearGradient></defs>
<rect width="1024" height="1024" rx="224" fill="url(#bg)"/>
<circle cx="512" cy="560" r="330" fill="#7c3aed" opacity="0.18"/>
<g transform="translate(128 150) scale(6)">${bird('idle')}</g>
</svg>
`;

fs.mkdirSync(OUT, { recursive: true });
for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(OUT, `${name}.svg`), text);
fs.writeFileSync(path.join(ROOT, 'assets', 'icon.svg'), icon);

let Resvg;
try {
  ({ Resvg } = createRequire(process.cwd() + '/')('@resvg/resvg-js'));
} catch {
  console.log('SVGs written; @resvg/resvg-js not found, PNG export skipped');
  process.exit(0);
}
for (const [name, text] of Object.entries(files)) {
  for (const [suffix, w] of [['', 128], ['@2x', 256]]) {
    const png = new Resvg(text, { fitTo: { mode: 'width', value: w }, font: { loadSystemFonts: true } }).render().asPng();
    fs.writeFileSync(path.join(OUT, `${name}${suffix}.png`), png);
  }
}
console.log(`wrote ${Object.keys(files).length} SVGs and PNGs to ${OUT}`);
