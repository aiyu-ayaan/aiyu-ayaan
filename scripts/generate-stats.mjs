// Generates the cards used in README.md (stats, languages, 3D contribution
// skyline, latest projects, releases, plus the hero, stack and experience
// cards whose content lives in data/*.json) and rebuilds the marked blocks
// of README.md from that data.
// No dependencies: Node 20+ and a GitHub token in GITHUB_TOKEN.
//
//   GITHUB_TOKEN=... node scripts/generate-stats.mjs
//
// Colours and the terminal chrome mirror https://me.aiyu.co.in

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateData } from './validate-data.mjs';

const LOGIN = process.env.GITHUB_LOGIN || 'aiyu-ayaan';
const TOKEN = process.env.GITHUB_TOKEN;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const EXCLUDED_LANGS = new Set(
  (process.env.EXCLUDE_LANGS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);
const README = join(OUT_DIR, '..', 'README.md');
const DATA_DIR = join(OUT_DIR, '..', 'data');
const MAX_LANGS = 6;
const LATEST_COUNT = 4;
const RELEASE_COUNT = 8;

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

// Stop before anything is written if a data file does not match its schema.
const problems = await validateData();
if (problems.length) {
  console.error(`data/ is invalid:\n${problems.map((e) => `  ${e}`).join('\n')}`);
  process.exit(1);
}

// Hand-written content. One JSON file per section in data/; edit those files,
// not the README blocks between <!-- name:start --> and <!-- name:end -->.
const load = async (name) => JSON.parse(await readFile(join(DATA_DIR, `${name}.json`), 'utf8'));
const content = {
  hero: await load('hero'),
  links: await load('links'),
  about: await load('about'),
  featured: await load('featured-projects'),
  more: await load('more-projects'),
  experience: await load('experience'),
  education: await load('education'),
  stack: await load('stack'),
  architecture: await load('architecture'),
  achievements: await load('achievements'),
};
const HERO = { ...content.hero, orbit: content.hero.orbit.map((o) => [o.label, o.color]) };
const STACK = content.stack.map((s) => [s.area.replace(' and ', ' + '), s.color, s.tools]);
const EXPERIENCE = [
  ...content.experience.map((e) => ({
    period: e.period,
    title: e.title,
    org: e.company,
    text: e.highlight,
    color: e.current ? theme.green : theme.blue,
    current: Boolean(e.current),
  })),
  ...content.education.map((e) => ({
    period: e.period,
    title: e.degree,
    org: e.school,
    text: `${e.detail}.`,
    color: theme.purple,
  })),
];

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
        releases(first: 5, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes { tagName publishedAt url isPrerelease isDraft }
        }
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
      // GitHub's latestRelease skips prereleases, which hides every project
      // still in alpha or beta. Take the newest published release instead.
      repo.latestRelease = repo.releases.nodes.find((r) => !r.isDraft && r.publishedAt) || null;
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

// Plain text for SVG: no emoji, and no Markdown links, bold or code marks.
const plain = (s) =>
  String(s || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*|`/g, '')
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

// Isometric cube centred on (cx, cy) with half-width s.
function isoCube(cx, cy, s, color) {
  return `<path d="${poly([[cx, cy - s], [cx + s, cy - s / 2], [cx, cy], [cx - s, cy - s / 2]])}" fill="${shade(color, 1.25)}"/><path d="${poly([[cx - s, cy - s / 2], [cx, cy], [cx, cy + s], [cx - s, cy + s / 2]])}" fill="${shade(color, 0.78)}"/><path d="${poly([[cx + s, cy - s / 2], [cx, cy], [cx, cy + s], [cx + s, cy + s / 2]])}" fill="${shade(color, 0.48)}"/>`;
}

// Isometric projection around a screen origin: x runs right-down, y runs
// left-down, z is up. k is the size of one unit in pixels.
const iso = (ox, oy, k) => (x, y, z = 0) => [ox + (x - y) * 0.866 * k, oy + (x + y) * 0.5 * k - z * k];

function isoBox(p, [x, y, z], [w, d, h], color) {
  return `<path d="${poly([p(x, y + d, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x, y + d, z + h)])}" fill="${color}"/><path d="${poly([p(x + w, y, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x + w, y, z + h)])}" fill="${shade(color, 0.6)}"/><path d="${poly([p(x, y, z + h), p(x + w, y, z + h), p(x + w, y + d, z + h), p(x, y + d, z + h)])}" fill="${shade(color, 1.35)}"/>`;
}

const PLATFORMS = ['android', 'web', 'desktop', 'server'];

// A small isometric device standing on (cx, cy), its screen lit in `color`.
function device(kind, cx, cy, color) {
  const p = iso(cx, cy, 2);
  const body = '#3b3b44';
  // A rectangle lying on the left-facing plane at depth y.
  const face = (x0, x1, z0, z1, y, fill, extra = '') =>
    `<path d="${poly([p(x0, y, z0), p(x1, y, z0), p(x1, y, z1), p(x0, y, z1)])}" fill="${fill}"${extra}/>`;
  if (kind === 'android') {
    return isoBox(p, [-3, -0.7, 0], [6, 1.4, 12], body) + face(-2.4, 2.4, 0.9, 11.1, 0.7, color, ' class="scr"');
  }
  if (kind === 'desktop') {
    return (
      isoBox(p, [-7, -4.4, 0.8], [14, 0.8, 9], body) +
      face(-6.3, 6.3, 1.5, 9.1, -3.6, color, ' class="scr"') +
      isoBox(p, [-7, -3.6, 0], [14, 8, 0.8], '#4a4a55')
    );
  }
  if (kind === 'web') {
    return (
      isoBox(p, [-7, -0.4, 1], [14, 0.8, 11], body) +
      face(-6.4, 6.4, 1.6, 11.4, 0.4, '#15151a') +
      face(-6.4, 6.4, 9.6, 11.4, 0.4, color, ' class="scr"') +
      face(-5.2, 2, 7, 7.8, 0.4, theme.muted, ' fill-opacity=".55"') +
      face(-5.2, 4.4, 4.8, 5.6, 0.4, theme.muted, ' fill-opacity=".35"')
    );
  }
  // server
  return (
    isoBox(p, [-4, -4, 0], [8, 8, 13], body) +
    [2.2, 5.6, 9]
      .map((z, i) => face(-3.2, 3.2, z, z + 2, 4, '#15151a') + face(1.6, 2.7, z + 0.6, z + 1.4, 4, color, ` class="led" style="animation-delay:${i * 0.4}s"`))
      .join('')
  );
}

// Shared shell for project cards: a face floating over its own extruded edge.
// `inner` is drawn in the face's coordinate space.
function slab({ width, height, color, index, label, title, inner }) {
  const fx = 6;
  const fy = 8;
  const fw = width - 22;
  const fh = height - 28;
  const ex = 9; // extrusion offset
  const ey = 11;
  const r = 12;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">
  <title>${esc(title)}</title>
  <style>
    text { font-family: ${FONT}; font-size: 12px; }
    .muted { fill: ${theme.muted}; }
    .text { fill: ${theme.text}; }
    .small { font-size: 11px; }
    .tiny { font-size: 9px; }
    .slab { animation: float 6s ease-in-out infinite; animation-delay: ${(index * -1.5).toFixed(1)}s; }
    .shadow { transform-box: fill-box; transform-origin: center; animation: shadow 6s ease-in-out infinite; animation-delay: ${(index * -1.5).toFixed(1)}s; }
    .cube { transform-box: fill-box; transform-origin: center; animation: bob 3s ease-in-out infinite; animation-delay: ${(index * -0.7).toFixed(1)}s; }
    .dev { animation: lift 4s ease-in-out infinite; }
    .scr { animation: lit 3s ease-in-out infinite; }
    .led { animation: blink 1.6s steps(1) infinite; }
    .sheen { animation: sheen 6s ease-in-out infinite; animation-delay: ${(index * 0.9).toFixed(1)}s; }
    @keyframes float { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-2px, -4px); } }
    @keyframes shadow { 0%, 100% { opacity: .75; transform: scale(1); } 50% { opacity: .45; transform: scale(.97); } }
    @keyframes bob { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-2.5px) scale(1.06); } }
    @keyframes lift { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
    @keyframes lit { 0%, 100% { opacity: 1; } 50% { opacity: .6; } }
    @keyframes blink { 50% { opacity: .15; } }
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
${inner}
    </g>
  </g>
</svg>
`;
}

// One recently pushed repository.
function projectCard(repo, index) {
  const width = 410;
  const height = 196;
  const fw = width - 22;
  const fh = height - 28;
  const color = repo.primaryLanguage?.color || theme.muted;
  const lang = repo.primaryLanguage?.name || 'Other';
  const description = wrap(plain(repo.description), 46, 3)
    .map((line, i) => `      <text x="20" y="${78 + i * 18}" class="muted">${esc(line)}</text>`)
    .join('\n');
  const footY = fh - 16;
  const stars = compact(repo.stargazerCount);
  const tagColor = repo.latestRelease?.isPrerelease ? theme.orange : theme.green;
  const release = repo.latestRelease
    ? `<rect x="${fw - 20 - repo.latestRelease.tagName.length * 6.7 - 14}" y="${footY - 13}" width="${repo.latestRelease.tagName.length * 6.7 + 14}" height="18" rx="9" fill="${tagColor}" fill-opacity=".12" stroke="${tagColor}" stroke-opacity=".45"/>
      <text x="${fw - 27}" y="${footY}" text-anchor="end" class="small" fill="${tagColor}">${esc(repo.latestRelease.tagName)}</text>`
    : '';
  const inner = `      <g class="cube">${isoCube(34, 36, 11, color)}</g>
      <text x="56" y="34" class="text" style="font-size:16px;font-weight:700">${esc(repo.name)}</text>
      <text x="56" y="50" class="small muted">pushed ${shortDate(repo.pushedAt)}</text>
      <g transform="translate(${fw - 20}, 22)">
        <text x="0" y="12" text-anchor="end" class="text" font-weight="600">${stars}</text>
        <path d="${STAR}" transform="translate(${-stars.length * 7.3 - 17}, 1.5)" fill="${theme.orange}"/>
      </g>
${description}
      <circle cx="25" cy="${footY - 4}" r="5" fill="${color}"/>
      <text x="37" y="${footY}" class="text small">${esc(lang)}</text>
      <path d="${FORK}" transform="translate(${45 + lang.length * 6.7}, ${footY - 10})" fill="${theme.muted}"/>
      <text x="${61 + lang.length * 6.7}" y="${footY}" class="muted small">${compact(repo.forkCount)}</text>
      ${release}`;
  return slab({ width, height, color, index, label: `${repo.name}: ${plain(repo.description)}`, title: repo.name, inner });
}

// One featured project from data/featured-projects.json, with a device for
// each platform it ships on. Stars and the release tag come from GitHub when
// the project's URL matches a public repository.
function featuredCard(project, index, repo) {
  const width = 410;
  const height = 282;
  const fw = width - 22;
  const fh = height - 28;
  const color = repo?.primaryLanguage?.color || theme.blue;

  const platforms = PLATFORMS.filter((k) => project.platforms.includes(k));
  const devices = platforms
    .map((kind, i) => {
      const cx = fw - 34 - (platforms.length - 1 - i) * 50;
      return `      <g class="dev" style="animation-delay:${(-i * 0.9).toFixed(1)}s">${device(kind, cx, 52, color)}</g>
      <text x="${cx}" y="76" text-anchor="middle" class="muted tiny">${kind}</text>`;
    })
    .join('\n');

  let meta = '';
  if (repo) {
    const stars = compact(repo.stargazerCount);
    const tag = repo.latestRelease;
    meta = `      <path d="${STAR}" transform="translate(56, 40) scale(.85)" fill="${theme.orange}"/>
      <text x="70" y="50" class="small text">${stars}</text>${
        tag
          ? `\n      <text x="${78 + stars.length * 6.7}" y="50" class="small" fill="${tag.isPrerelease ? theme.orange : theme.green}">${esc(tag.tagName)}</text>`
          : ''
      }`;
  }

  const summary = wrap(plain(project.summary), 48, 5)
    .map((line, i) => `      <text x="20" y="${106 + i * 17}" class="muted">${esc(line)}</text>`)
    .join('\n');
  const stack = wrap(project.stack, 52, 2)
    .map((line, i) => `      <text x="20" y="${fh - 32 + i * 15}" class="small" fill="${shade(color, 1.35)}">${esc(line)}</text>`)
    .join('\n');
  const inner = `      <g class="cube">${isoCube(34, 36, 11, color)}</g>
      <text x="56" y="34" class="text" style="font-size:16px;font-weight:700">${esc(project.name)}</text>
${meta}
${devices}
${summary}
      <rect x="20" y="${fh - 52}" width="${fw - 40}" height="1" fill="${theme.border}"/>
${stack}`;
  return slab({
    width,
    height,
    color,
    index,
    label: `${project.name}: ${plain(project.summary)} Runs on ${platforms.join(', ')}. Stack: ${project.stack}.`,
    title: project.name,
    inner,
  });
}

// Newest published release of each public repository, newest first.
// Stable tags are green, prereleases (alpha, beta, rc) are orange.
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
    <text x="560" y="${y}" text-anchor="end" fill="${rel.isPrerelease ? theme.orange : theme.green}" font-weight="600">${esc(rel.tagName)}</text>
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

// README.md is partly generated: each block between <!-- name:start --> and
// <!-- name:end --> is rebuilt from data/*.json or from GitHub.
const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => ':--').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

// shields.io path segment: dashes and underscores are doubled, spaces become underscores.
const badgePart = (s) => encodeURIComponent(s.replace(/-/g, '--').replace(/_/g, '__').replace(/ /g, '_'));

function readmeBlocks(projects) {
  const cell = (repo, i) =>
    `  <a href="${repo.url}"><img src="assets/latest-${i + 1}.svg" width="49%" alt="${esc(`${repo.name}: ${plain(repo.description)}`)}" /></a>`;
  // Two cards per centred row.
  const grid = (cells) => {
    const out = [];
    for (let i = 0; i < cells.length; i += 2) out.push(`<p align="center">\n${cells.slice(i, i + 2).join('\n')}\n</p>`);
    return out.join('\n');
  };
  const project = (p) => `[**${p.name}**](${p.url})`;
  return {
    links: `<p align="center">\n${content.links
      .map(
        (l) =>
          `  <a href="${l.url}"><img src="https://img.shields.io/badge/${badgePart(l.label)}-${badgePart(l.text)}-007ec6?style=flat-square" alt="${esc(l.alt)}" /></a>`,
      )
      .join('\n')}\n</p>`,
    about: [...content.about.paragraphs, content.about.bullets.map((b) => `- **${b.label}:** ${b.text}`).join('\n')].join('\n\n'),
    'latest-projects': grid(projects.map(cell)),
    'featured-projects': `${grid(
      content.featured.map(
        (p, i) =>
          `  <a href="${p.url}"><img src="assets/featured-${i + 1}.svg" width="49%" alt="${esc(`${p.name}: ${plain(p.summary)}`)}" /></a>`,
      ),
    )}\n\n<details>\n<summary>Text version</summary>\n<br>\n\n${table(
      ['Project', 'Summary', 'Stack', 'Platforms'],
      content.featured.map((p) => [project(p), p.summary, p.stack, p.platforms.join(', ')]),
    )}\n\n</details>`,
    'more-projects': table(['Project', 'Summary'], content.more.map((p) => [project(p), p.summary])),
    experience: table(
      ['Period', 'Role', 'Highlights'],
      content.experience.map((e) => [e.period, `**${e.title}**, ${e.company}`, e.highlight]),
    ),
    education: `**Education:** ${content.education.map((e) => `${e.degree} (${e.period}, ${e.detail}), ${e.school}`).join('; ')}.`,
    stack: table(['Area', 'Tools'], content.stack.map((s) => [s.area, s.tools.join(', ')])),
  };
}

async function updateReadme(projects) {
  let readme;
  try {
    readme = await readFile(README, 'utf8');
  } catch {
    return;
  }
  let next = readme;
  for (const [name, body] of Object.entries(readmeBlocks(projects))) {
    const start = `<!-- ${name}:start -->`;
    const end = `<!-- ${name}:end -->`;
    const from = next.indexOf(start);
    const to = next.indexOf(end);
    if (from === -1 || to === -1 || to < from) {
      console.warn(`README.md has no ${name} markers; that block was not updated`);
      continue;
    }
    next = `${next.slice(0, from + start.length)}\n${body}\n${next.slice(to)}`;
  }
  if (next !== readme) await writeFile(README, next);
}

// Header: the name extruded in 3D over a perspective floor that scrolls
// towards the viewer, with language cubes orbiting in front of and behind it.
function heroCard() {
  const width = 840;
  const height = 322;
  const cx = width / 2;
  const horizon = 224;
  const floorH = height - horizon;

  // Floor: cross lines sit on a quadratic depth curve; each one slides to the
  // next line's position, so the loop is seamless.
  const rows = 9;
  const rowY = (i) => (i / rows) ** 2 * floorH;
  const cross = Array.from({ length: rows }, (_, i) => {
    const a = rowY(i);
    const b = rowY(i + 1);
    return `      <line class="fl" x1="0" x2="${width}" y1="${horizon}" y2="${horizon}" style="--a:${n1(a)}px;--b:${n1(b)}px;--oa:${(i / rows).toFixed(2)};--ob:${((i + 1) / rows).toFixed(2)}"/>`;
  }).join('\n');
  const rays = Array.from({ length: 29 }, (_, i) => {
    const k = i - 14;
    return `      <line x1="${cx + k * 6}" y1="${horizon}" x2="${cx + k * 96}" y2="${height}"/>`;
  }).join('\n');

  // Extrusion: the same text stacked along a diagonal, darkest at the back.
  const layers = 16;
  const extrusion = Array.from({ length: layers }, (_, i) => {
    const o = (layers - i) * 0.9;
    return `      <use href="#name" x="${n1(o)}" y="${n1(o)}" fill="${shade(theme.blue, 0.22 + (i / layers) * 0.38)}"/>`;
  }).join('\n');

  // Orbit: x and y run the same sine a quarter period apart, which traces an
  // ellipse. Each cube exists twice, behind and in front of the name, and the
  // two copies swap visibility as the cube crosses the ends of the ellipse.
  const period = 16;
  const orbit = (layer) =>
    HERO.orbit
      .map(([label, color], i) => {
        const phase = (i * period) / HERO.orbit.length;
        const s = 15;
        return `      <g class="ox" style="animation-delay:${(-(phase + period / 4)).toFixed(2)}s"><g class="oy" style="animation-delay:${(-phase).toFixed(2)}s"><g class="${layer}" style="animation-delay:${(-phase).toFixed(2)}s">${isoCube(0, 0, s, color)}<text transform="matrix(1 .5 0 1 ${-s / 2} ${s / 2 + 0.5})" text-anchor="middle" style="font-size:9px;font-weight:700" fill="#fff" fill-opacity=".92">${esc(label)}</text></g></g></g>`;
      })
      .join('\n');

  const chipY = 270;
  const chipW = (t) => t.length * 6.7 + 22;
  const chipsWidth = HERO.focus.reduce((sum, t) => sum + chipW(t), 0) + (HERO.focus.length - 1) * 10;
  let chipX = cx - chipsWidth / 2;
  const chips = HERO.focus
    .map((t, i) => {
      const w = chipW(t);
      const out = `    <g class="fade" style="--d:${(1.1 + i * 0.12).toFixed(2)}s"><rect x="${n1(chipX)}" y="${chipY - 15}" width="${n1(w)}" height="22" rx="11" fill="${theme.bg}" fill-opacity=".85" stroke="${theme.border}"/><text x="${n1(chipX + w / 2)}" y="${chipY}" text-anchor="middle" class="muted small">${esc(t)}</text></g>`;
      chipX += w + 10;
      return out;
    })
    .join('\n');

  const taglineWidth = HERO.tagline.length * 7.8;
  const body = `  <style>
    .fl { animation: flow 1.5s linear infinite; }
    .ox { animation: ox ${period / 2}s cubic-bezier(.37,0,.63,1) infinite alternate; }
    .oy { animation: oy ${period / 2}s cubic-bezier(.37,0,.63,1) infinite alternate; }
    .front { animation: front ${period}s linear infinite; }
    .back { animation: back ${period}s linear infinite; }
    .hover { animation: hover 6s ease-in-out infinite; }
    .glow { animation: glow 6s ease-in-out infinite; }
    .cursor { animation: blink 1.1s steps(1) infinite; }
    .fade { animation: fade .7s ease-out both; animation-delay: var(--d); }
    @keyframes flow { from { transform: translateY(var(--a)); opacity: var(--oa); } to { transform: translateY(var(--b)); opacity: var(--ob); } }
    @keyframes ox { from { transform: translateX(-340px); } to { transform: translateX(340px); } }
    @keyframes oy { from { transform: translateY(-34px) scale(.7); } to { transform: translateY(34px) scale(1.15); } }
    @keyframes front { 0%, 24.99% { opacity: 0; } 25%, 75% { opacity: 1; } 75.01%, 100% { opacity: 0; } }
    @keyframes back { 0%, 24.99% { opacity: .75; } 25%, 75% { opacity: 0; } 75.01%, 100% { opacity: .75; } }
    @keyframes hover { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
    @keyframes glow { 0%, 100% { opacity: .55; } 50% { opacity: .9; } }
    @keyframes blink { 50% { opacity: 0; } }
    @keyframes fade { from { opacity: 0; transform: translateY(6px); } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } .orbit { display: none; } }
  </style>
  <defs>
    <clipPath id="stage"><rect x="1" y="35" width="${width - 2}" height="${height - 36}" rx="9"/></clipPath>
    <radialGradient id="halo"><stop offset="0" stop-color="${theme.blue}" stop-opacity=".34"/><stop offset="1" stop-color="${theme.blue}" stop-opacity="0"/></radialGradient>
    <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.bg}"/><stop offset=".55" stop-color="${theme.bg}" stop-opacity="0"/></linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${theme.blue}" stop-opacity="0"/><stop offset=".5" stop-color="${theme.blue}"/><stop offset="1" stop-color="${theme.blue}" stop-opacity="0"/></linearGradient>
    <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#a9d4ff"/></linearGradient>
    <text id="name" x="${cx}" y="168" text-anchor="middle" style="font-size:88px;font-weight:800;letter-spacing:10px">${esc(HERO.name)}</text>
  </defs>
  <g clip-path="url(#stage)">
    <ellipse class="glow" cx="${cx}" cy="150" rx="330" ry="120" fill="url(#halo)"/>
    <g stroke="${theme.blue}" stroke-opacity=".5" stroke-width="1">
${rays}
${cross}
    </g>
    <rect x="0" y="${horizon}" width="${width}" height="${floorH}" fill="url(#mist)"/>
    <rect x="60" y="${horizon - 0.5}" width="${width - 120}" height="1.5" fill="url(#edge)"/>
    <g class="orbit" transform="translate(${cx}, 138)">
${orbit('back')}
    </g>
    <g class="hover">
${extrusion}
      <use href="#name" fill="url(#ink)"/>
    </g>
    <g class="orbit" transform="translate(${cx}, 138)">
${orbit('front')}
    </g>
    <text x="${cx}" y="76" text-anchor="middle" class="fade" style="--d:.2s"><tspan fill="${theme.blue}">$</tspan><tspan class="muted" dx="7">${esc(HERO.greeting)}</tspan></text>
    <g class="fade" style="--d:.7s">
      <text x="${cx}" y="208" text-anchor="middle" class="text" stroke="${theme.bg}" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${esc(HERO.tagline)}</text>
      <rect class="cursor" x="${n1(cx + taglineWidth / 2 + 5)}" y="196" width="8" height="15" fill="${theme.blue}"/>
    </g>
    <text x="${cx}" y="244" text-anchor="middle" class="fade small" style="--d:.9s" fill="${theme.blue}" stroke="${theme.bg}" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${esc(HERO.role)}</text>
${chips}
  </g>`;
  return card({
    width,
    height,
    command: 'aiyu — portfolio',
    label: `Hi, I'm Ayaan. ${HERO.tagline} ${HERO.role}.`,
    body,
  });
}

// Tech stack as rows of raised keys, one row group per area.
function stackCard() {
  const width = 840;
  const labelX = 20;
  const tilesX = 190;
  const maxX = width - 20;
  const tileH = 26;
  const depth = 5;
  const gap = 8;
  const lineH = tileH + depth + 9;
  let y = 54;
  let index = 0;
  const parts = [];
  for (const [area, color, tools] of STACK) {
    parts.push(`  <g class="fade" style="--d:${(index * 0.03).toFixed(2)}s">${isoCube(labelX + 8, y + 15, 8, color)}<text x="${labelX + 26}" y="${y + 19}" class="muted small" style="letter-spacing:.6px">${esc(area.toUpperCase())}</text></g>`);
    let x = tilesX;
    for (const tool of tools) {
      const w = Math.round(tool.length * 7.3 + 22);
      if (x + w > maxX) {
        x = tilesX;
        y += lineH;
      }
      parts.push(`  <g class="pop" style="--i:${index}"><rect x="${x}" y="${y + depth}" width="${w}" height="${tileH}" rx="6" fill="${shade(color, 0.36)}"/><g class="key" style="--i:${index}"><rect x="${x}" y="${y}" width="${w}" height="${tileH}" rx="6" fill="#17171b" stroke="${shade(color, 0.7)}"/><rect x="${x + 7}" y="${y + 1}" width="${w - 14}" height="1" fill="${color}" fill-opacity=".7"/><text x="${x + w / 2}" y="${y + 17.5}" text-anchor="middle" class="text" style="font-size:12px">${esc(tool)}</text></g></g>`);
      x += w + gap;
      index++;
    }
    y += lineH + 8;
  }
  const height = y + 4;
  const body = `  <style>
    .pop { animation: pop .5s cubic-bezier(.2,.9,.25,1.3) both; animation-delay: calc(var(--i) * 35ms); }
    .key { animation: press 9s ease-in-out infinite; animation-delay: calc(2.5s + var(--i) * 110ms); }
    .fade { animation: fade .6s ease-out both; animation-delay: var(--d); }
    @keyframes pop { from { opacity: 0; transform: translateY(8px); } }
    @keyframes press { 0%, 5%, 100% { transform: translateY(0); } 2.5% { transform: translateY(${depth - 1}px); } }
    @keyframes fade { from { opacity: 0; } }
    ${REDUCED_MOTION}
  </style>
${parts.join('\n')}`;
  return card({
    width,
    height,
    command: 'cat ./stack.toml',
    label: `Tech stack. ${STACK.map(([area, , tools]) => `${area}: ${tools.join(', ')}`).join('. ')}.`,
    body,
  });
}

// Experience and education on one extruded rail, newest at the top.
function experienceCard() {
  const width = 840;
  const railX = 34;
  const textX = 64;
  let y = 62;
  const nodes = [];
  const rows = EXPERIENCE.map((item, i) => {
    const lines = wrap(item.text, 103, 3);
    const top = y;
    nodes.push([top - 4, item]);
    const out = `  <g class="row" style="--i:${i}">
    <text x="${textX}" y="${top}" class="text" style="font-size:14px;font-weight:700">${esc(item.title)}<tspan class="muted" style="font-size:13px;font-weight:400" dx="8">at</tspan><tspan fill="${item.color}" style="font-size:13px;font-weight:600" dx="8">${esc(item.org)}</tspan></text>
    <text x="${width - 20}" y="${top}" text-anchor="end" class="${item.current ? 'text' : 'muted'} small">${esc(item.period)}</text>
${lines.map((line, j) => `    <text x="${textX}" y="${top + 21 + j * 17}" class="muted" style="font-size:12px">${esc(line)}</text>`).join('\n')}
  </g>`;
    y = top + 21 + lines.length * 17 + 20;
    return out;
  }).join('\n');
  const height = y - 12;
  const railTop = nodes[0][0];
  const railBottom = nodes[nodes.length - 1][0];
  const cubes = nodes
    .map(([ny, item], i) => {
      const ring = item.current
        ? `<ellipse class="ping" cx="${railX}" cy="${ny + 9}" rx="13" ry="6.5" fill="none" stroke="${item.color}" stroke-width="1.5"/>`
        : '';
      return `  <g class="row" style="--i:${i}">${ring}${isoCube(railX, ny, 9, item.color)}</g>`;
    })
    .join('\n');
  const body = `  <style>
    .row { animation: in .6s ease-out both; animation-delay: calc(.2s + var(--i) * 160ms); }
    .rail { transform-box: fill-box; transform-origin: 50% 0; animation: draw 1.1s ease-out both; }
    .ping { transform-box: fill-box; transform-origin: center; animation: ping 2.4s ease-out infinite; }
    @keyframes in { from { opacity: 0; transform: translateX(-10px); } }
    @keyframes draw { from { transform: scaleY(0); } }
    @keyframes ping { from { opacity: .9; transform: scale(.6); } to { opacity: 0; transform: scale(1.7); } }
    ${REDUCED_MOTION}
  </style>
  <g class="rail">
    <rect x="${railX - 2}" y="${railTop}" width="4" height="${railBottom - railTop}" fill="${theme.faint}"/>
    <rect x="${railX + 2}" y="${railTop}" width="2.5" height="${railBottom - railTop}" fill="#232327"/>
  </g>
${cubes}
${rows}`;
  return card({
    width,
    height,
    command: 'git log --author=ayaan --format=career',
    label: `Experience: ${EXPERIENCE.map((e) => `${e.title} at ${e.org}, ${e.period}`).join('; ')}.`,
    body,
  });
}

// How one project is put together, from data/architecture.json: clients at the
// top, then the edge, the services, and the stores. Dashes march along every
// link in the direction requests travel.
function architectureCard() {
  const A = content.architecture;
  const width = 840;
  const clientY = 98;
  const edgeY = 182;
  const svcY = 272;
  const busY = 358;
  const storeY = 404;
  const height = 448;
  const cx = width / 2;

  const lines = [];
  const link = (x1, y1, x2, y2, cls = 'flow') => lines.push(`  <path class="${cls}" d="M${n1(x1)} ${n1(y1)}L${n1(x2)} ${n1(y2)}"/>`);
  const label = (x, y, text, cls, anchor = 'middle') =>
    `<text x="${n1(x)}" y="${n1(y)}" text-anchor="${anchor}" class="${cls}" stroke="${theme.bg}" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${esc(text)}</text>`;
  const nodes = [];

  // Edge: tunnel then gateway, side by side in the middle.
  const edgeGap = 180;
  const edgeX = A.edge.map((_, i) => cx + 30 + (i - (A.edge.length - 1) / 2) * edgeGap);
  A.edge.forEach((e, i) => {
    const x = edgeX[i];
    const color = i === A.edge.length - 1 ? theme.blue : theme.orange;
    if (i > 0) link(edgeX[i - 1] + 18, edgeY, x - 18, edgeY);
    const left = i === 0;
    nodes.push(`  <g class="node" style="--i:${3 + i}">${isoCube(x, edgeY, 15, color)}${label(x + (left ? -24 : 24), edgeY - 2, e.name, 'text', left ? 'end' : 'start')}${label(x + (left ? -24 : 24), edgeY + 12, e.detail, 'muted tiny', left ? 'end' : 'start')}</g>`);
  });

  // Clients converge on the first edge node.
  const clientGap = 120;
  const clientX = A.clients.map((_, i) => edgeX[0] + (i - (A.clients.length - 1) / 2) * clientGap);
  A.clients.forEach((c, i) => {
    const x = clientX[i];
    link(x, clientY + 22, edgeX[0], edgeY - 20);
    nodes.push(`  <g class="node" style="--i:${i}">${device(c.kind, x, clientY, theme.blue)}${label(x, clientY + 18, c.name, 'text small')}</g>`);
  });

  // Peer-to-peer media never touches the servers: an arc over the clients.
  const first = clientX[0];
  const last = clientX[clientX.length - 1];
  const arc = `  <path class="p2p" d="M${n1(first)} ${clientY - 34}Q${n1((first + last) / 2)} ${clientY - 72} ${n1(last)} ${clientY - 34}"/>
  ${wrap(A.p2p, 40, 2).map((line, i) => `<text x="${n1(last + 38)}" y="${clientY - 26 + i * 14}" class="small" fill="${theme.green}">${esc(line)}</text>`).join('\n  ')}`;

  // Services in one row, fed by the gateway, draining into a shared bus.
  const gate = edgeX[edgeX.length - 1];
  const svcGap = (width - 160) / Math.max(A.services.length - 1, 1);
  const svcX = A.services.map((_, i) => 80 + i * svcGap);
  A.services.forEach((s, i) => {
    const x = svcX[i];
    link(gate, edgeY + 18, x, svcY - 16);
    link(x, svcY + 14, x, busY, 'flow data');
    nodes.push(`  <g class="node" style="--i:${6 + i}">${isoCube(x, svcY, 13, theme.green)}${label(x, svcY + 30, s.name, 'text small')}${label(x, svcY + 43, `:${s.port}`, 'tiny', 'middle').replace('class="tiny"', `class="tiny" fill="${theme.green}"`)}${label(x, svcY + 56, s.detail, 'muted tiny')}</g>`);
  });
  lines.push(`  <path class="bus" d="M${n1(svcX[0])} ${busY}H${n1(svcX[svcX.length - 1])}"/>`);

  // Stores hang off the bus.
  const storeGap = 220;
  A.stores.forEach((s, i) => {
    const x = cx + (i - (A.stores.length - 1) / 2) * storeGap - 40;
    link(x, busY, x, storeY - 12, 'flow data');
    nodes.push(`  <g class="node" style="--i:${14 + i}">
    <path d="M${x - 14} ${storeY - 8}V${storeY + 8}A14 6 0 0 0 ${x + 14} ${storeY + 8}V${storeY - 8}Z" fill="${shade(theme.pink, 0.55)}"/>
    <ellipse cx="${x}" cy="${storeY - 8}" rx="14" ry="6" fill="${shade(theme.pink, 1.15)}"/>
    <path d="M${x - 14} ${storeY}A14 6 0 0 0 ${x + 14} ${storeY}" fill="none" stroke="${theme.bg}" stroke-opacity=".5"/>
    ${label(x + 24, storeY - 1, s.name, 'text small', 'start')}${label(x + 24, storeY + 12, s.detail, 'muted tiny', 'start')}</g>`);
  });

  const notes = wrap(A.encryption, 25, 5)
    .map((note, i) => `  <text x="24" y="${62 + i * 15}" class="muted small">${esc(note)}</text>`)
    .join('\n');

  const body = `  <style>
    .tiny { font-size: 10px; }
    path.flow, path.p2p, path.bus { fill: none; stroke-linecap: round; }
    .flow { stroke: ${theme.blue}; stroke-opacity: .55; stroke-width: 1.2; stroke-dasharray: 2 7; animation: march 1.1s linear infinite; }
    .data { stroke: ${theme.pink}; }
    .bus { stroke: ${theme.pink}; stroke-opacity: .5; stroke-width: 1.5; }
    .p2p { stroke: ${theme.green}; stroke-width: 1.4; stroke-dasharray: 5 5; animation: swing 1.4s linear infinite alternate; }
    .node { animation: in .55s ease-out both; animation-delay: calc(var(--i) * 70ms); }
    @keyframes march { from { stroke-dashoffset: 9; } to { stroke-dashoffset: 0; } }
    @keyframes swing { from { stroke-dashoffset: 10; } to { stroke-dashoffset: 0; } }
    @keyframes in { from { opacity: 0; transform: translateY(8px); } }
    ${REDUCED_MOTION}
  </style>
${notes}
${lines.join('\n')}
${arc}
${nodes.join('\n')}`;
  return card({
    width,
    height,
    command: `docker compose ps  # ${A.project}`,
    label: `${A.project} architecture. Clients: ${A.clients.map((c) => c.name).join(', ')}. Edge: ${A.edge.map((e) => e.name).join(', ')}. Services: ${A.services.map((s) => s.name).join(', ')}. Stores: ${A.stores.map((s) => s.name).join(', ')}. ${A.p2p}`,
    body,
  });
}

// Deterministic pseudo-random numbers, so the star field does not change between runs.
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Every public repository as a sphere on a tilted disc that turns slowly:
// size follows stars, colour follows language, the most starred sit nearest
// the core. Each sphere rests at its own position, so the picture is complete
// even where animation is off.
function galaxyCard(data) {
  const width = 840;
  const height = 404;
  const cx = width / 2;
  const cy = 222;
  const tilt = 0.4;
  const period = 150;
  const repos = [...data.repos].sort((a, b) => b.stargazerCount - a.stargazerCount || b.pushedAt.localeCompare(a.pushedAt));
  const n = repos.length || 1;

  const colors = new Map();
  const gradientId = (color) => {
    if (!colors.has(color)) colors.set(color, `s${colors.size}`);
    return colors.get(color);
  };

  const bodies = repos.map((repo, i) => {
    const color = repo.primaryLanguage?.color || theme.muted;
    const r = 3.2 + Math.sqrt(repo.stargazerCount) * 2.7;
    const orbit = 44 + (368 - 44) * Math.sqrt((i + 0.5) / n);
    const phase = (i * 0.61803398875) % 1; // golden-ratio spacing
    const angle = phase * 2 * Math.PI;
    const depth = -Math.cos(angle); // -1 far, +1 near
    const named = i < 7 && repo.stargazerCount > 0;
    return {
      depth,
      svg: `    <g class="gx" style="--r:${n1(orbit)};--x:${n1(orbit * Math.sin(angle))};animation-delay:${(-(phase * period + period / 4)).toFixed(1)}s"><g class="gy" style="--r:${n1(orbit * tilt)};--y:${n1(orbit * tilt * depth)};--s:${(0.95 + depth * 0.22).toFixed(2)};animation-delay:${(-(phase * period)).toFixed(1)}s"><circle r="${n1(r)}" fill="url(#${gradientId(color)})"/>${
        named ? `<text x="${n1(r + 5)}" y="3.5" class="text" style="font-size:10px">${esc(repo.name)}</text>` : ''
      }</g></g>`,
    };
  });
  // Far spheres first, so near ones overlap them in the resting picture.
  bodies.sort((a, b) => a.depth - b.depth);

  const gradients = [...colors]
    .map(
      ([color, id]) =>
        `    <radialGradient id="${id}" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="${shade(color, 1.6)}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${shade(color, 0.35)}"/></radialGradient>`,
    )
    .join('\n');

  const rand = seeded(7);
  const dust = Array.from({ length: 90 }, (_, i) => {
    const x = 8 + rand() * (width - 16);
    const y = 42 + rand() * (height - 50);
    return `<circle class="tw" style="animation-delay:${(-rand() * 5).toFixed(1)}s" cx="${n1(x)}" cy="${n1(y)}" r="${(0.4 + rand() * 0.7).toFixed(1)}"/>`;
  }).join('');

  // Languages by number of repositories.
  const byLang = new Map();
  for (const repo of repos) {
    const name = repo.primaryLanguage?.name;
    if (!name) continue;
    const entry = byLang.get(name) || { name, color: repo.primaryLanguage.color || theme.muted, count: 0 };
    entry.count++;
    byLang.set(name, entry);
  }
  let lx = 24;
  const legend = [...byLang.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((l) => {
      const out = `<circle cx="${lx + 4}" cy="${height - 22}" r="4" fill="${l.color}"/><text x="${lx + 13}" y="${height - 18}" class="muted small">${esc(l.name)} <tspan class="text">${l.count}</tspan></text>`;
      lx += 13 + (l.name.length + String(l.count).length + 1) * 6.7 + 18;
      return out;
    })
    .join('');

  const body = `  <style>
    .gx { transform: translateX(calc(var(--x) * 1px)); animation: gx ${period / 2}s cubic-bezier(.37,0,.63,1) infinite alternate; }
    .gy { transform: translateY(calc(var(--y) * 1px)) scale(var(--s)); animation: gy ${period / 2}s cubic-bezier(.37,0,.63,1) infinite alternate; }
    .tw { fill: #fff; animation: tw 5s ease-in-out infinite; }
    .core { animation: core 7s ease-in-out infinite; }
    @keyframes gx { from { transform: translateX(calc(var(--r) * -1px)); } to { transform: translateX(calc(var(--r) * 1px)); } }
    @keyframes gy { from { transform: translateY(calc(var(--r) * -1px)) scale(.73); } to { transform: translateY(calc(var(--r) * 1px)) scale(1.17); } }
    @keyframes tw { 0%, 100% { opacity: .15; } 50% { opacity: .7; } }
    @keyframes core { 0%, 100% { opacity: .6; } 50% { opacity: 1; } }
    ${REDUCED_MOTION}
  </style>
  <defs>
    <clipPath id="sky"><rect x="1" y="35" width="${width - 2}" height="${height - 36}" rx="9"/></clipPath>
    <radialGradient id="corehalo"><stop offset="0" stop-color="#cfe6ff" stop-opacity=".5"/><stop offset=".25" stop-color="${theme.blue}" stop-opacity=".22"/><stop offset="1" stop-color="${theme.blue}" stop-opacity="0"/></radialGradient>
${gradients}
  </defs>
  <g clip-path="url(#sky)">
    ${dust}
    <ellipse class="core" cx="${cx}" cy="${cy}" rx="300" ry="${300 * tilt}" fill="url(#corehalo)"/>
    <g transform="translate(${cx}, ${cy})">
${bodies.map((b) => b.svg).join('\n')}
    </g>
  </g>
  <text x="24" y="62" class="text" style="font-size:20px;font-weight:700">${n}<tspan class="muted small" dx="7" style="font-weight:400">public repositories</tspan></text>
  <text x="24" y="80" class="muted small">size = stars, colour = language</text>
  ${legend}`;
  return card({
    width,
    height,
    command: 'gh repo list --public | galaxy --3d',
    label: `${n} public repositories by ${LOGIN} drawn as a rotating galaxy, sized by stars and coloured by language. Most starred: ${repos.slice(0, 5).map((r) => `${r.name} (${r.stargazerCount})`).join(', ')}.`,
    body,
  });
}

// A shelf of pedestals, one per entry in data/achievements.json. An entry
// either names a live GitHub number (`source`) or carries its own `value`.
function achievementsCard(data) {
  const facts = contributionFacts(data.weeks);
  const live = {
    contributions: data.yearTotal,
    commits: data.commits,
    longestStreak: facts.longest,
    currentStreak: facts.current,
    pullRequests: data.pullRequests,
    issues: data.issues,
    stars: data.stars,
    repositories: data.repos.length,
    followers: data.followers,
  };
  const palette = [theme.blue, theme.green, theme.orange, theme.purple, theme.pink, '#64d2ff', '#ffd60a'];
  const items = content.achievements.map((a, i) => ({
    value: a.source ? compact(live[a.source]) : a.value,
    label: a.label,
    color: a.color || palette[i % palette.length],
  }));

  const width = 840;
  const height = 252;
  const step = (width - 40) / items.length;
  const groundY = 176;
  const body = items
    .map((item, i) => {
      const cx = 20 + step * (i + 0.5);
      const p = iso(cx, groundY, 1);
      const topY = groundY - 26;
      const gy = topY - 34;
      const gem = `<g class="gem" style="animation-delay:${(-i * 0.55).toFixed(2)}s">
      <path d="${poly([[cx, gy - 15], [cx - 11, gy], [cx + 2, gy + 3]])}" fill="${shade(item.color, 1.5)}"/>
      <path d="${poly([[cx, gy - 15], [cx + 11, gy], [cx + 2, gy + 3]])}" fill="${shade(item.color, 1.05)}"/>
      <path d="${poly([[cx, gy + 15], [cx - 11, gy], [cx + 2, gy + 3]])}" fill="${shade(item.color, 0.72)}"/>
      <path d="${poly([[cx, gy + 15], [cx + 11, gy], [cx + 2, gy + 3]])}" fill="${shade(item.color, 0.42)}"/>
    </g>`;
      const labelLines = wrap(item.label, 15, 2)
        .map((line, j) => `<text x="${n1(cx)}" y="${groundY + 38 + j * 13}" text-anchor="middle" class="muted" style="font-size:10px">${esc(line)}</text>`)
        .join('');
      return `  <g class="rise" style="--i:${i}">
    ${isoBox(p, [-17, -17, 0], [34, 34, 26], '#26262c')}
    <path d="${poly([p(-17, 17, 26), p(17, 17, 26), p(17, -17, 26)])}" fill="none" stroke="${item.color}" stroke-width="1.2" stroke-linejoin="round"/>
    <ellipse class="pool" style="animation-delay:${(-i * 0.55).toFixed(2)}s" cx="${n1(cx)}" cy="${topY}" rx="11" ry="5" fill="${item.color}" fill-opacity=".35"/>
    ${gem}
    <text x="${n1(cx)}" y="${gy - 28}" text-anchor="middle" class="text" style="font-size:19px;font-weight:700">${esc(item.value)}</text>
    ${labelLines}
  </g>`;
    })
    .join('\n');

  const style = `  <style>
    .rise { animation: rise .7s cubic-bezier(.2,.9,.25,1.15) both; animation-delay: calc(var(--i) * 110ms); }
    .gem { animation: hover 3.8s ease-in-out infinite; }
    .pool { transform-box: fill-box; transform-origin: center; animation: pool 3.8s ease-in-out infinite; }
    @keyframes rise { from { opacity: 0; transform: translateY(16px); } }
    @keyframes hover { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @keyframes pool { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(.7); opacity: .5; } }
    ${REDUCED_MOTION}
  </style>`;
  return card({
    width,
    height,
    command: 'ls ./achievements',
    label: `Achievements: ${items.map((a) => `${a.value} ${a.label}`).join('; ')}.`,
    body: `${style}\n${body}`,
  });
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
await writeFile(join(OUT_DIR, 'hero.svg'), heroCard());
await writeFile(join(OUT_DIR, 'stack.svg'), stackCard());
await writeFile(join(OUT_DIR, 'experience.svg'), experienceCard());
if (releases) await writeFile(join(OUT_DIR, 'releases.svg'), releases);
await Promise.all(projects.map((repo, i) => writeFile(join(OUT_DIR, `latest-${i + 1}.svg`), projectCard(repo, i))));
await Promise.all(
  content.featured.map((project, i) => {
    const repo = data.repos.find((r) => r.url.toLowerCase() === project.url.toLowerCase().replace(/\/$/, ''));
    return writeFile(join(OUT_DIR, `featured-${i + 1}.svg`), featuredCard(project, i, repo));
  }),
);
await writeFile(join(OUT_DIR, 'architecture.svg'), architectureCard());
await writeFile(join(OUT_DIR, 'galaxy.svg'), galaxyCard(data));
await writeFile(join(OUT_DIR, 'achievements.svg'), achievementsCard(data));
await updateReadme(projects);

console.log(
  `Wrote stats for ${LOGIN}: ${data.stars} stars, ${data.commits} commits, ${data.repos.length} public repos, ${data.languages.length} languages, latest: ${projects.map((r) => r.name).join(', ')}`,
);
