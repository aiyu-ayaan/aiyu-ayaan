// Generates the cards used in README.md (stats, languages, 3D contribution
// skyline, latest projects, releases) and rewrites the README's
// latest-projects block so each card links to the right repository.
// No dependencies: Node 20+ and a GitHub token in GITHUB_TOKEN.
//
//   GITHUB_TOKEN=... node scripts/generate-stats.mjs
//
// Colours and the terminal chrome mirror https://me.aiyu.co.in

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOGIN = process.env.GITHUB_LOGIN || 'aiyu-ayaan';
const TOKEN = process.env.GITHUB_TOKEN;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const EXCLUDED_LANGS = new Set(
  (process.env.EXCLUDE_LANGS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);
const README = join(OUT_DIR, '..', 'README.md');
const MAX_LANGS = 6;
const LATEST_COUNT = 4;
const RELEASE_COUNT = 6;

const theme = {
  bg: '#0b0b0d',
  bar: '#111114',
  border: '#2b2b30',
  text: '#f5f5f7',
  muted: '#86868b',
  faint: '#3a3a3c',
  blue: '#2997ff',
  green: '#30d158',
  orange: '#ff9f0a',
  pink: '#ff375f',
  purple: '#bf5af2',
};
const FONT = `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`;

if (!TOKEN) {
  console.error('GITHUB_TOKEN is not set');
  process.exit(1);
}

const QUERY = `
query ($login: String!, $after: String) {
  user(login: $login) {
    followers { totalCount }
    pullRequests { totalCount }
    issues { totalCount }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount date weekday } }
      }
    }
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        description
        url
        homepageUrl
        isPrivate
        isArchived
        pushedAt
        forkCount
        primaryLanguage { name color }
        latestRelease { tagName publishedAt url }
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function graphql(variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': `${LOGIN}-profile-stats`,
    },
    body: JSON.stringify({ query: QUERY, variables }),
  });
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  if (!body.data?.user) throw new Error(`User "${LOGIN}" not found`);
  return body.data.user;
}

async function collect() {
  let after = null;
  let user;
  let stars = 0;
  const langs = new Map();
  const repos = [];

  do {
    user = await graphql({ login: LOGIN, after });
    for (const repo of user.repositories.nodes) {
      stars += repo.stargazerCount;
      // Only public repositories may ever be named in the README.
      if (!repo.isPrivate) repos.push(repo);
      for (const { size, node } of repo.languages.edges) {
        if (EXCLUDED_LANGS.has(node.name.toLowerCase())) continue;
        const entry = langs.get(node.name) || { name: node.name, color: node.color || theme.muted, size: 0 };
        entry.size += size;
        langs.set(node.name, entry);
      }
    }
    after = user.repositories.pageInfo.endCursor;
  } while (user.repositories.pageInfo.hasNextPage);

  const contributions = user.contributionsCollection;
  return {
    stars,
    commits: contributions.totalCommitContributions + contributions.restrictedContributionsCount,
    pullRequests: user.pullRequests.totalCount,
    issues: user.issues.totalCount,
    repoCount: user.repositories.totalCount,
    followers: user.followers.totalCount,
    yearTotal: contributions.contributionCalendar.totalContributions,
    weeks: contributions.contributionCalendar.weeks.map((w) =>
      w.contributionDays.map((d) => ({ count: d.contributionCount, date: d.date, weekday: d.weekday })),
    ),
    repos,
    languages: [...langs.values()].sort((a, b) => b.size - a.size),
  };
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const compact = (n) =>
  n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);

// Shared window chrome: rounded frame, title bar with three dots and a prompt.
function card({ width, height, command, label, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">
  <title>${esc(label)}</title>
  <style>
    text { font-family: ${FONT}; font-size: 13px; }
    .muted { fill: ${theme.muted}; }
    .text { fill: ${theme.text}; }
    .small { font-size: 11px; }
  </style>
  <clipPath id="frame"><rect width="${width}" height="${height}" rx="10"/></clipPath>
  <g clip-path="url(#frame)">
    <rect width="${width}" height="${height}" fill="${theme.bg}"/>
    <rect width="${width}" height="34" fill="${theme.bar}"/>
    <rect y="34" width="${width}" height="1" fill="${theme.border}"/>
  </g>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="none" stroke="${theme.border}"/>
  <circle cx="20" cy="17" r="5" fill="${theme.pink}"/>
  <circle cx="38" cy="17" r="5" fill="${theme.orange}"/>
  <circle cx="56" cy="17" r="5" fill="${theme.green}"/>
  <text x="76" y="21.5" class="small"><tspan fill="${theme.blue}">$</tspan><tspan class="muted" dx="7">${esc(command)}</tspan></text>
${body}
</svg>
`;
}

function statsCard(data) {
  const width = 410;
  const rows = [
    ['stars earned', data.stars],
    ['commits, past year', data.commits],
    ['pull requests', data.pullRequests],
    ['issues', data.issues],
    ['repositories', data.repoCount],
    ['followers', data.followers],
  ];
  const rowHeight = 25;
  const top = 62;
  const height = top + (rows.length - 1) * rowHeight + 24;
  const body = rows
    .map(([name, value], i) => {
      const y = top + i * rowHeight;
      const valueText = compact(value);
      // Dotted leader between label and value; mono glyphs are ~7.8px wide at 13px.
      const from = 20 + name.length * 7.8 + 10;
      const to = width - 20 - valueText.length * 7.8 - 10;
      return `  <text x="20" y="${y}" class="muted">${esc(name)}</text>
  <line x1="${from.toFixed(1)}" y1="${y - 4}" x2="${to.toFixed(1)}" y2="${y - 4}" stroke="${theme.faint}" stroke-dasharray="1 5" stroke-linecap="round"/>
  <text x="${width - 20}" y="${y}" class="text" text-anchor="end" font-weight="600">${valueText}</text>`;
    })
    .join('\n');
  return card({ width, height, command: `gh stats --user ${LOGIN}`, label: `GitHub stats for ${LOGIN}`, body });
}

// ---------------------------------------------------------------------------
// 3D helpers. GitHub renders README images as static <img>, so there is no
// JavaScript and no real 3D context: every solid below is projected to plain
// SVG paths here, and CSS keyframes inside the SVG provide the motion.
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const n1 = (v) => String(Math.round(v * 10) / 10);
const poly = (points) => `M${points.map(([x, y]) => `${n1(x)} ${n1(y)}`).join('L')}Z`;

// Multiply a #rrggbb colour towards black (f < 1) or mix it towards white (f > 1).
function shade(hex, f) {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.replace(/./g, (ch) => ch + ch) : c;
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  const out = rgb.map((v) => (f <= 1 ? v * f : v + (255 - v) * (f - 1)));
  return `#${out.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

const shortDate = (iso) => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

const plain = (s) =>
  String(s || '')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

function wrap(text, maxChars, maxLines) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]} ${lines[maxLines]}`.slice(0, maxChars - 1);
  last = last.replace(/[\s,.;:]+\S*$/, '');
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

const REDUCED_MOTION = `@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }`;

function contributionFacts(weeks) {
  const days = weeks.flat();
  const today = new Date().toISOString().slice(0, 10);
  let longest = 0;
  let run = 0;
  let best = days[0];
  const byWeekday = Array(7).fill(0);
  for (const day of days) {
    run = day.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
    if (day.count > best.count) best = day;
    byWeekday[day.weekday] += day.count;
  }
  // A day that has not finished yet does not break the streak.
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) current++;
    else if (days[i].date < today || i < days.length - 1) break;
  }
  return {
    current,
    longest,
    best,
    activeDays: days.filter((d) => d.count > 0).length,
    totalDays: days.length,
    busiest: WEEKDAYS[byWeekday.indexOf(Math.max(...byWeekday))],
  };
}

// The contribution calendar as an isometric city: one block per day, a year of
// weeks running left to right, block height following the day's contributions.
function skylineCard(data) {
  const width = 840;
  const height = 404;
  const weeks = data.weeks;
  const facts = contributionFacts(weeks);
  const max = Math.max(facts.best.count, 1);

  // Screen-space basis vectors for one week step, one weekday step, and height.
  const wv = [13.3, 3.4];
  const dv = [-8.6, 6.6];
  const origin = [86, 138];
  const maxHeight = 88;
  const P = (w, d, z = 0) => [origin[0] + w * wv[0] + d * dv[0], origin[1] + w * wv[1] + d * dv[1] - z];

  const ramp = ['#123a63', '#1a5ea3', '#2181e0', '#2997ff', '#6cc0ff'];
  const level = (count) => Math.min(ramp.length - 1, Math.floor((count / max) ** 0.5 * ramp.length));
  const g = 0.13;

  const columns = weeks
    .map((week, w) => {
      const cells = week
        .map((day) => {
          const d = day.weekday;
          if (day.count === 0) {
            return `<path class="z" d="${poly([P(w + g, d + g), P(w + 1 - g, d + g), P(w + 1 - g, d + 1 - g), P(w + g, d + 1 - g)])}"/>`;
          }
          const h = 5 + (day.count / max) ** 0.62 * (maxHeight - 5);
          const peak = day === facts.best;
          const k = peak ? 'p' : level(day.count);
          const top = poly([P(w + g, d + g, h), P(w + 1 - g, d + g, h), P(w + 1 - g, d + 1 - g, h), P(w + g, d + 1 - g, h)]);
          const left = poly([P(w + g, d + 1 - g), P(w + 1 - g, d + 1 - g), P(w + 1 - g, d + 1 - g, h), P(w + g, d + 1 - g, h)]);
          const right = poly([P(w + 1 - g, d + 1 - g), P(w + 1 - g, d + g), P(w + 1 - g, d + g, h), P(w + 1 - g, d + 1 - g, h)]);
          return `<g class="b"><path class="l${k}" d="${left}"/><path class="r${k}" d="${right}"/><path class="t${k}" d="${top}"/></g>`;
        })
        .join('');
      return `  <g class="w" style="--i:${w}">${cells}</g>`;
    })
    .join('\n');

  // Ground slab under the city.
  const W = weeks.length;
  const m = 0.45;
  const slabDepth = 9;
  const slab = `  <path d="${poly([P(-m, 7 + m), P(W + m, 7 + m), P(W + m, 7 + m, -slabDepth), P(-m, 7 + m, -slabDepth)])}" fill="#0e0e11" stroke="${theme.border}" stroke-linejoin="round"/>
  <path d="${poly([P(W + m, 7 + m), P(W + m, -m), P(W + m, -m, -slabDepth), P(W + m, 7 + m, -slabDepth)])}" fill="#09090b" stroke="${theme.border}" stroke-linejoin="round"/>
  <path d="${poly([P(-m, -m), P(W + m, -m), P(W + m, 7 + m), P(-m, 7 + m)])}" fill="#131317" stroke="${theme.border}" stroke-linejoin="round"/>`;

  // Month names along the front edge, at the first week that starts in a new month.
  let lastMonth = -1;
  const months = weeks
    .map((week, w) => {
      const month = new Date(week[0].date).getUTCMonth();
      if (month === lastMonth) return '';
      const first = lastMonth === -1;
      lastMonth = month;
      if (first && new Date(week[0].date).getUTCDate() > 14) return '';
      const [x, y] = P(w + 0.5, 7 + m, -slabDepth);
      return `  <text x="${n1(x - 6)}" y="${n1(y + 14)}" class="muted tiny">${MONTHS[month]}</text>`;
    })
    .join('\n');

  // Callout over the tallest block.
  const peakWeek = weeks.findIndex((week) => week.includes(facts.best));
  const peakHeight = 5 + (maxHeight - 5);
  const [px, py] = P(peakWeek + 0.5, facts.best.weekday + 0.5, peakHeight);
  const anchor = px > width - 150 ? 'end' : 'start';
  const lx = anchor === 'end' ? px - 8 : px + 8;
  const callout =
    facts.best.count > 0
      ? `  <g class="fade" style="--d:1.9s">
    <line x1="${n1(px)}" y1="${n1(py - 3)}" x2="${n1(px)}" y2="${n1(py - 26)}" stroke="${theme.orange}" stroke-width="1"/>
    <circle cx="${n1(px)}" cy="${n1(py - 26)}" r="2.5" fill="${theme.orange}"/>
    <text x="${n1(lx)}" y="${n1(py - 23)}" class="tiny" text-anchor="${anchor}" stroke="${theme.bg}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"><tspan fill="${theme.orange}" font-weight="600">${facts.best.count}</tspan><tspan class="muted"> on ${shortDate(facts.best.date)}</tspan></text>
  </g>`
      : '';

  // Headline number sits in the empty corner above the right end of the city.
  const headline = `  <g class="fade" style="--d:.5s">
    <text x="${width - 24}" y="82" text-anchor="end" class="text" style="font-size:34px;font-weight:700">${data.yearTotal.toLocaleString('en-US')}</text>
    <text x="${width - 24}" y="102" text-anchor="end" class="muted small">contributions in the past year</text>
    <text x="${width - 24}" y="120" text-anchor="end" class="muted small">active on <tspan class="text">${facts.activeDays}</tspan> of ${facts.totalDays} days</text>
  </g>`;

  // Four facts in the empty corner under the left end.
  const tiles = [
    ['current streak', `${facts.current}`, facts.current === 1 ? 'day' : 'days', theme.green],
    ['longest streak', `${facts.longest}`, facts.longest === 1 ? 'day' : 'days', theme.blue],
    ['best day', `${facts.best.count}`, shortDate(facts.best.date), theme.orange],
    ['busiest weekday', facts.busiest.slice(0, 3), '', theme.purple],
  ]
    .map(([label, value, unit, color], i) => {
      const x = 24 + i * 112;
      const y = height - 54;
      return `  <g class="fade" style="--d:${(0.8 + i * 0.12).toFixed(2)}s">
    <rect x="${x}" y="${y}" width="2" height="34" rx="1" fill="${color}"/>
    <text x="${x + 10}" y="${y + 10}" class="muted tiny">${label}</text>
    <text x="${x + 10}" y="${y + 31}" class="text" style="font-size:18px;font-weight:700">${esc(value)}<tspan class="muted tiny" dx="5" style="font-weight:400">${esc(unit)}</tspan></text>
  </g>`;
    })
    .join('\n');

  const faces = [...ramp.map((c, i) => [i, c]), ['p', theme.orange]]
    .map(([k, c]) => `.t${k}{fill:${shade(c, 1.12)}}.l${k}{fill:${shade(c, 0.62)}}.r${k}{fill:${shade(c, 0.4)}}`)
    .join('\n    ');

  const body = `  <style>
    .tiny { font-size: 10px; }
    .z { fill: #1b1b20; }
    ${faces}
    .b { transform-box: fill-box; transform-origin: 50% 100%; animation: rise .8s cubic-bezier(.2,.9,.25,1.15) both; animation-delay: calc(var(--i) * 24ms); }
    .w { animation: wave 7s ease-in-out infinite; animation-delay: calc(2.4s + var(--i) * 70ms); }
    .fade { animation: fade .7s ease-out both; animation-delay: var(--d); }
    @keyframes rise { from { transform: scaleY(0); opacity: 0; } }
    @keyframes wave { 0%, 22%, 100% { transform: translateY(0); } 9% { transform: translateY(-5px); } }
    @keyframes fade { from { opacity: 0; transform: translateY(6px); } }
    ${REDUCED_MOTION}
  </style>
${headline}
${slab}
${columns}
${months}
${callout}
${tiles}`;

  return card({
    width,
    height,
    command: 'git log --since="1 year ago" | skyline --3d',
    label: `${data.yearTotal} contributions by ${LOGIN} in the past year, drawn as a 3D skyline. Current streak ${facts.current} days, longest streak ${facts.longest} days.`,
    body,
  });
}

// Language share as one extruded slab cut into a segment per language.
function languagesCard(data, height) {
  const width = 410;
  const total = data.languages.reduce((sum, l) => sum + l.size, 0) || 1;
  const top = data.languages.slice(0, MAX_LANGS);
  const rest = data.languages.slice(MAX_LANGS).reduce((sum, l) => sum + l.size, 0);
  const slices = rest > 0 ? [...top, { name: 'Other', color: theme.muted, size: rest }] : top;

  const depth = [16, -11]; // screen offset of the slab's back edge
  const barX = 20;
  const barY = 66;
  const barH = 20;
  const barWidth = width - 40 - depth[0];
  let x = barX;
  const segments = slices
    .map((l, i) => {
      const w = Math.max((l.size / total) * barWidth, 1.5);
      const x2 = x + w;
      const front = poly([[x, barY], [x2, barY], [x2, barY + barH], [x, barY + barH]]);
      const lid = poly([[x, barY], [x2, barY], [x2 + depth[0], barY + depth[1]], [x + depth[0], barY + depth[1]]]);
      const cap =
        i === slices.length - 1
          ? `<path d="${poly([[x2, barY], [x2 + depth[0], barY + depth[1]], [x2 + depth[0], barY + barH + depth[1]], [x2, barY + barH]])}" fill="${shade(l.color, 0.45)}"/>`
          : '';
      x = x2;
      return `  <g class="seg" style="--i:${i}"><path d="${front}" fill="${shade(l.color, 0.8)}"/><path d="${lid}" fill="${shade(l.color, 1.15)}"/>${cap}<path d="M${n1(x2)} ${barY}V${barY + barH}" stroke="${theme.bg}" stroke-opacity=".55"/></g>`;
    })
    .join('\n');

  const colWidth = (width - 40) / 2;
  const legendTop = 122;
  const legend = slices
    .map((l, i) => {
      const lx = barX + (i % 2) * colWidth;
      const ly = legendTop + Math.floor(i / 2) * rowGap(slices.length, height, legendTop);
      const pct = ((l.size / total) * 100).toFixed(1);
      return `  <g class="fade" style="--i:${i}"><rect x="${lx}" y="${ly - 9.5}" width="10" height="10" rx="2.5" fill="${l.color}"/>
  <text x="${lx + 18}" y="${ly}" class="text">${esc(l.name)}</text>
  <text x="${lx + colWidth - 16}" y="${ly}" class="muted" text-anchor="end">${pct}%</text></g>`;
    })
    .join('\n');

  const body = `  <style>
    .seg { animation: drop .7s cubic-bezier(.2,.9,.25,1.2) both; animation-delay: calc(var(--i) * 90ms); }
    .fade { animation: fade .6s ease-out both; animation-delay: calc(.5s + var(--i) * 60ms); }
    @keyframes drop { from { opacity: 0; transform: translateY(-14px); } }
    @keyframes fade { from { opacity: 0; } }
    ${REDUCED_MOTION}
  </style>
  <ellipse cx="${width / 2}" cy="${barY + barH + 9}" rx="${barWidth / 2 + 6}" ry="5" fill="#000" opacity=".55"/>
${segments}
${legend}`;
  return card({ width, height, command: 'ls ./languages --sort=size', label: `Most used languages for ${LOGIN}`, body });
}

// Spread legend rows over the space left under the slab so both cards share a height.
function rowGap(count, height, top) {
  const rows = Math.ceil(count / 2);
  return rows > 1 ? Math.min((height - top - 22) / (rows - 1), 30) : 0;
}

// Public, described, non-archived repositories, most recently pushed first.
function latestProjects(data) {
  return data.repos
    .filter((r) => !r.isArchived && r.description && r.name.toLowerCase() !== LOGIN.toLowerCase())
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))
    .slice(0, LATEST_COUNT);
}

const STAR = 'M6 .6l1.7 3.4 3.7.5-2.7 2.6.6 3.7L6 9.1 2.7 10.8l.6-3.7L.6 4.5l3.7-.5z';
const FORK =
  'M3 1.2a1.5 1.5 0 0 1 .6 2.9v1.2c0 .5.4.9.9.9h3c.5 0 .9-.4.9-.9V4.1a1.5 1.5 0 1 1 1.2 0v1.2A2.1 2.1 0 0 1 7.5 7.4H6.6v1.5a1.5 1.5 0 1 1-1.2 0V7.4H4.5A2.1 2.1 0 0 1 2.4 5.3V4.1A1.5 1.5 0 0 1 3 1.2z';

// One repository as a raised slab: the face floats over its own extruded edge.
function projectCard(repo, index) {
  const width = 410;
  const height = 196;
  const color = repo.primaryLanguage?.color || theme.muted;
  const lang = repo.primaryLanguage?.name || 'Other';
  const fx = 6;
  const fy = 8;
  const fw = width - 22;
  const fh = height - 28;
  const ex = 9; // extrusion offset
  const ey = 11;
  const r = 12;

  const lines = wrap(plain(repo.description), 46, 3);
  const description = lines
    .map((line, i) => `      <text x="20" y="${78 + i * 18}" class="muted">${esc(line)}</text>`)
    .join('\n');

  // Isometric cube in the language colour.
  const cx = 34;
  const cy = 36;
  const s = 11;
  const cube = `<g class="cube">
        <path d="${poly([[cx, cy - s], [cx + s, cy - s / 2], [cx, cy], [cx - s, cy - s / 2]])}" fill="${shade(color, 1.25)}"/>
        <path d="${poly([[cx - s, cy - s / 2], [cx, cy], [cx, cy + s], [cx - s, cy + s / 2]])}" fill="${shade(color, 0.78)}"/>
        <path d="${poly([[cx + s, cy - s / 2], [cx, cy], [cx, cy + s], [cx + s, cy + s / 2]])}" fill="${shade(color, 0.48)}"/>
      </g>`;

  const footY = fh - 16;
  const release = repo.latestRelease
    ? `<rect x="${fw - 20 - repo.latestRelease.tagName.length * 6.7 - 14}" y="${footY - 13}" width="${repo.latestRelease.tagName.length * 6.7 + 14}" height="18" rx="9" fill="${theme.green}" fill-opacity=".12" stroke="${theme.green}" stroke-opacity=".45"/>
      <text x="${fw - 27}" y="${footY}" text-anchor="end" class="small" fill="${theme.green}">${esc(repo.latestRelease.tagName)}</text>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${repo.name}: ${plain(repo.description)}`)}">
  <title>${esc(repo.name)}</title>
  <style>
    text { font-family: ${FONT}; font-size: 12px; }
    .muted { fill: ${theme.muted}; }
    .text { fill: ${theme.text}; }
    .small { font-size: 11px; }
    .slab { animation: float 6s ease-in-out infinite; animation-delay: ${(index * -1.5).toFixed(1)}s; }
    .shadow { transform-box: fill-box; transform-origin: center; animation: shadow 6s ease-in-out infinite; animation-delay: ${(index * -1.5).toFixed(1)}s; }
    .cube { transform-box: fill-box; transform-origin: center; animation: bob 3s ease-in-out infinite; animation-delay: ${(index * -0.7).toFixed(1)}s; }
    .sheen { animation: sheen 6s ease-in-out infinite; animation-delay: ${(index * 0.9).toFixed(1)}s; }
    @keyframes float { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-2px, -4px); } }
    @keyframes shadow { 0%, 100% { opacity: .75; transform: scale(1); } 50% { opacity: .45; transform: scale(.97); } }
    @keyframes bob { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-2.5px) scale(1.06); } }
    @keyframes sheen { 0%, 55% { transform: translateX(-140px); } 100% { transform: translateX(${width + 140}px); } }
    ${REDUCED_MOTION}
  </style>
  <defs>
    <linearGradient id="face" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#17171b"/><stop offset="1" stop-color="${theme.bg}"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="clip"><rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="${r}"/></clipPath>
  </defs>
  <rect class="shadow" x="${fx + ex + 3}" y="${fy + ey + 3}" width="${fw}" height="${fh}" rx="${r}" fill="#000"/>
  <g class="slab">
    <rect x="${fx + ex}" y="${fy + ey}" width="${fw}" height="${fh}" rx="${r}" fill="${shade(color, 0.3)}"/>
    <path d="M${fx + r} ${fy + fh}L${fx + ex + r} ${fy + fh + ey}H${fx + fw + ex - r}L${fx + fw + ex} ${fy + fh + ey - r}V${fy + ey + r}L${fx + fw} ${fy + r}V${fy + fh}Z" fill="${shade(color, 0.42)}"/>
    <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="${r}" fill="url(#face)"/>
    <g clip-path="url(#clip)">
      <rect x="${fx}" y="${fy}" width="${fw}" height="3" fill="url(#glow)"/>
      <rect class="sheen" x="0" y="${fy}" width="120" height="${fh}" fill="url(#shine)" transform="skewX(-18)"/>
    </g>
    <rect x="${fx + 0.5}" y="${fy + 0.5}" width="${fw - 1}" height="${fh - 1}" rx="${r}" fill="none" stroke="${theme.border}"/>
    <g transform="translate(${fx}, ${fy})">
      ${cube}
      <text x="56" y="34" class="text" style="font-size:16px;font-weight:700">${esc(repo.name)}</text>
      <text x="56" y="50" class="small muted">pushed ${shortDate(repo.pushedAt)}</text>
      <g transform="translate(${fw - 20}, 22)">
        <text x="0" y="12" text-anchor="end" class="text" font-weight="600">${compact(repo.stargazerCount)}</text>
        <path d="${STAR}" transform="translate(${-compact(repo.stargazerCount).length * 7.3 - 17}, 1.5)" fill="${theme.orange}"/>
      </g>
${description}
      <circle cx="25" cy="${footY - 4}" r="5" fill="${color}"/>
      <text x="37" y="${footY}" class="text small">${esc(lang)}</text>
      <path d="${FORK}" transform="translate(${45 + lang.length * 6.7}, ${footY - 10})" fill="${theme.muted}"/>
      <text x="${61 + lang.length * 6.7}" y="${footY}" class="muted small">${compact(repo.forkCount)}</text>
      ${release}
    </g>
  </g>
</svg>
`;
  return svg;
}

// Newest tagged release of each public repository, newest first.
function releasesCard(data) {
  const rows = data.repos
    .filter((r) => r.latestRelease && !r.isArchived)
    .sort((a, b) => b.latestRelease.publishedAt.localeCompare(a.latestRelease.publishedAt))
    .slice(0, RELEASE_COUNT);
  if (rows.length === 0) return null;

  const width = 840;
  const rowHeight = 27;
  const top = 64;
  const height = top + (rows.length - 1) * rowHeight + 26;
  const now = Date.now();
  const body = rows
    .map((repo, i) => {
      const y = top + i * rowHeight;
      const rel = repo.latestRelease;
      const color = repo.primaryLanguage?.color || theme.muted;
      const days = Math.max(0, Math.floor((now - new Date(rel.publishedAt)) / 86400000));
      const fresh = days <= 30;
      const date = `${shortDate(rel.publishedAt)}, ${new Date(rel.publishedAt).getUTCFullYear()}`;
      const from = 44 + repo.name.length * 7.8 + 12;
      const tagWidth = rel.tagName.length * 7.8;
      const to = 560 - tagWidth - 12;
      return `  <g class="row" style="--i:${i}">
    <path d="${poly([[26, y - 11], [32, y - 8], [26, y - 5], [20, y - 8]])}" fill="${shade(color, 1.2)}"/>
    <path d="${poly([[20, y - 8], [26, y - 5], [26, y + 1], [20, y - 2]])}" fill="${shade(color, 0.75)}"/>
    <path d="${poly([[32, y - 8], [26, y - 5], [26, y + 1], [32, y - 2]])}" fill="${shade(color, 0.45)}"/>
    <text x="44" y="${y}" class="text" font-weight="600">${esc(repo.name)}</text>
    <line x1="${from.toFixed(1)}" y1="${y - 4}" x2="${to.toFixed(1)}" y2="${y - 4}" stroke="${theme.faint}" stroke-dasharray="1 5" stroke-linecap="round"/>
    <text x="560" y="${y}" text-anchor="end" fill="${fresh ? theme.green : theme.blue}" font-weight="600">${esc(rel.tagName)}</text>
    <text x="${width - 150}" y="${y}" text-anchor="end" class="muted">${esc(repo.primaryLanguage?.name || '')}</text>
    <text x="${width - 20}" y="${y}" text-anchor="end" class="${fresh ? 'text' : 'muted'}">${date}</text>
  </g>`;
    })
    .join('\n');

  const style = `  <style>
    .row { animation: in .5s ease-out both; animation-delay: calc(var(--i) * 90ms); }
    @keyframes in { from { opacity: 0; transform: translateX(-10px); } }
    ${REDUCED_MOTION}
  </style>`;
  return card({
    width,
    height,
    command: 'gh release list --all-repos --latest',
    label: `Latest releases by ${LOGIN}: ${rows.map((r) => `${r.name} ${r.latestRelease.tagName}`).join(', ')}`,
    body: `${style}\n${body}`,
  });
}

// Card links live in README.md, so the block between the markers is rewritten
// whenever the set of latest projects changes.
async function updateReadme(projects) {
  const start = '<!-- latest-projects:start -->';
  const end = '<!-- latest-projects:end -->';
  let readme;
  try {
    readme = await readFile(README, 'utf8');
  } catch {
    return false;
  }
  const from = readme.indexOf(start);
  const to = readme.indexOf(end);
  if (from === -1 || to === -1 || to < from) {
    console.warn('README.md has no latest-projects markers; links were not updated');
    return false;
  }
  const cell = (repo, i) =>
    `  <a href="${repo.url}"><img src="assets/latest-${i + 1}.svg" width="49%" alt="${esc(`${repo.name}: ${plain(repo.description)}`)}" /></a>`;
  const rowsOf = [];
  for (let i = 0; i < projects.length; i += 2) {
    rowsOf.push(`<p align="center">\n${projects.slice(i, i + 2).map((repo, j) => cell(repo, i + j)).join('\n')}\n</p>`);
  }
  const next = `${readme.slice(0, from + start.length)}\n${rowsOf.join('\n')}\n${readme.slice(to)}`;
  if (next !== readme) await writeFile(README, next);
  return true;
}

const data = await collect();
const stats = statsCard(data);
const statsHeight = Number(stats.match(/height="(\d+)"/)[1]);
const projects = latestProjects(data);
const releases = releasesCard(data);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, 'stats.svg'), stats);
await writeFile(join(OUT_DIR, 'languages.svg'), languagesCard(data, statsHeight));
await writeFile(join(OUT_DIR, 'skyline.svg'), skylineCard(data));
if (releases) await writeFile(join(OUT_DIR, 'releases.svg'), releases);
await Promise.all(projects.map((repo, i) => writeFile(join(OUT_DIR, `latest-${i + 1}.svg`), projectCard(repo, i))));
await updateReadme(projects);

console.log(
  `Wrote stats for ${LOGIN}: ${data.stars} stars, ${data.commits} commits, ${data.repos.length} public repos, ${data.languages.length} languages, latest: ${projects.map((r) => r.name).join(', ')}`,
);
