#!/usr/bin/env node
/**
 * Genera las tarjetas de actividad del perfil como SVG estáticos dentro del repo.
 *
 * Motivo: los servicios públicos de stats (github-readme-stats, streak-stats,
 * profile-trophy) se caen, se pausan o se quedan sin cuota, y el perfil aparece
 * roto justo cuando alguien lo está mirando. Aquí los datos se consultan contra
 * la API de GitHub y se renderizan a SVG versionados en este mismo repositorio,
 * así que la única dependencia es GitHub.
 *
 * Uso:
 *   GH_TOKEN=<token> USERNAME=Owito node scripts/generate-stats.mjs
 *
 * El token por defecto de Actions (GITHUB_TOKEN) solo ve la actividad pública.
 * Para incluir el trabajo en repositorios privados hace falta un PAT con
 * `read:user` guardado como secreto `STATS_TOKEN`; si no está, la tarjeta se
 * degrada sola y omite la métrica de trabajo privado.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets');

const USERNAME = process.env.USERNAME || 'Owito';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('Falta GH_TOKEN / GITHUB_TOKEN.');
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * Tokens de diseño
 * ------------------------------------------------------------------ */

// Superficies reales sobre las que GitHub renderiza el README.
const THEMES = {
  light: {
    surface: '#ffffff',
    ink: '#1f2328',
    muted: '#59636e',
    rule: '#d1d9e0',
    track: '#eaeef2',
    bar: '#1f2328',
  },
  dark: {
    surface: '#0d1117',
    ink: '#e6edf3',
    muted: '#9198a1',
    rule: '#2f3742',
    track: '#21262d',
    bar: '#e6edf3',
  },
};

const FONT =
  "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

const W = 860;
const PAD = 4;

const COPY = {
  es: {
    metrics: [
      'Contribuciones · 12 meses',
      'Pull requests integrados',
      'Repositorios propios',
      'Trabajo en repos privados',
    ],
    langsTitle: 'Distribución del código',
    langsNote: (n) => `${n} repositorios propios · sin forks`,
    updated: 'Actualizado',
    months: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  },
  en: {
    metrics: [
      'Contributions · 12 months',
      'Pull requests merged',
      'Own repositories',
      'Work in private repos',
    ],
    langsTitle: 'Code distribution',
    langsNote: (n) => `${n} own repositories · forks excluded`,
    updated: 'Updated',
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  },
};

/* ------------------------------------------------------------------ *
 * Consulta de datos
 * ------------------------------------------------------------------ */

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'User-Agent': `${USERNAME}-profile-stats`,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GitHub devuelve 502/503 de forma intermitente; reintentar con backoff. */
async function request(url, init = {}, attempts = 6) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { ...init, headers: { ...HEADERS, ...init.headers } });
      if (res.ok) return res;
      if (res.status < 500 && res.status !== 429) {
        throw new Error(`HTTP ${res.status} en ${url}: ${await res.text()}`);
      }
      lastError = new Error(`HTTP ${res.status} en ${url}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(600 * 2 ** i);
  }
  throw lastError;
}

async function graphql(query, variables = {}) {
  const res = await request('https://api.github.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL: ${JSON.stringify(body.errors)}`);
  return body.data;
}

async function rest(path) {
  return (await request(`https://api.github.com${path}`)).json();
}

/**
 * Los lenguajes se leen por REST y no por GraphQL: la conexión `languages`
 * dispara el límite de complejidad de la API y devuelve 503 de forma
 * sistemática para cuentas con muchos repositorios.
 */
async function collectLanguages() {
  const me = await rest('/user');
  const owned = me.login.toLowerCase() === USERNAME.toLowerCase();

  const repos = [];
  for (let page = 1; page <= 10; page += 1) {
    const path = owned
      ? `/user/repos?affiliation=owner&per_page=100&page=${page}`
      : `/users/${USERNAME}/repos?type=owner&per_page=100&page=${page}`;
    const batch = await rest(path);
    repos.push(...batch.filter((r) => !r.fork));
    if (batch.length < 100) break;
  }

  const languages = new Map();
  for (const repo of repos) {
    const bytes = await rest(`/repos/${repo.full_name}/languages`);
    for (const [name, size] of Object.entries(bytes)) {
      languages.set(name, (languages.get(name) || 0) + size);
    }
  }

  return { languages, repoCount: repos.length };
}

async function collect() {
  const totals = await graphql(
    `
      query ($login: String!) {
        user(login: $login) {
          pullRequests(states: MERGED) {
            totalCount
          }
          contributionsCollection {
            restrictedContributionsCount
            contributionCalendar {
              totalContributions
            }
          }
        }
      }
    `,
    { login: USERNAME },
  );

  const { languages, repoCount } = await collectLanguages();
  const contributions = totals.user.contributionsCollection;

  return {
    contributions: contributions.contributionCalendar.totalContributions,
    restricted: contributions.restrictedContributionsCount,
    mergedPrs: totals.user.pullRequests.totalCount,
    repoCount,
    languages,
  };
}

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const nf = (locale) => new Intl.NumberFormat(locale === 'es' ? 'es-CO' : 'en-US');

function shell(width, height, theme, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="GitHub activity">
  <rect width="${width}" height="${height}" fill="${theme.surface}"/>
${body}
</svg>
`;
}

function metricsCard({ data, theme, locale, stamp, includePrivate }) {
  const t = COPY[locale];
  const fmt = nf(locale);
  const share = Math.round((data.restricted / Math.max(data.contributions, 1)) * 100);

  const values = [
    fmt.format(data.contributions),
    fmt.format(data.mergedPrs),
    fmt.format(data.repoCount),
    `${share}%`,
  ];
  const labels = [...t.metrics];

  // Sin PAT no hay dato de repos privados: se omite la columna en vez de mentir.
  const count = includePrivate ? 4 : 3;
  const height = 128;
  const colW = (W - PAD * 2) / count;

  let body = `  <line x1="${PAD}" y1="12" x2="${W - PAD}" y2="12" stroke="${theme.rule}" stroke-width="1"/>\n`;

  for (let i = 0; i < count; i += 1) {
    const x = PAD + colW * i;
    body += `  <text x="${x}" y="62" font-family="${FONT}" font-size="34" font-weight="600" fill="${theme.ink}" letter-spacing="-0.6">${esc(values[i])}</text>\n`;
    body += `  <text x="${x}" y="86" font-family="${FONT}" font-size="11" font-weight="500" fill="${theme.muted}" letter-spacing="0.9">${esc(labels[i].toUpperCase())}</text>\n`;
    if (i > 0) {
      body += `  <line x1="${x - 24}" y1="34" x2="${x - 24}" y2="90" stroke="${theme.rule}" stroke-width="1"/>\n`;
    }
  }

  body += `  <line x1="${PAD}" y1="108" x2="${W - PAD}" y2="108" stroke="${theme.rule}" stroke-width="1"/>\n`;
  body += `  <text x="${PAD}" y="123" font-family="${MONO}" font-size="10" fill="${theme.muted}">${esc(`${t.updated} ${stamp}`)}</text>\n`;

  return shell(W, height, theme, body);
}

function languagesCard({ data, theme, locale, top = 6 }) {
  const t = COPY[locale];
  const entries = [...data.languages.entries()].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, size]) => sum + size, 0) || 1;
  const rows = entries.slice(0, top).map(([name, size]) => ({
    name,
    pct: (size / total) * 100,
  }));

  const rowH = 30;
  const startY = 58;
  const height = startY + rows.length * rowH + 22;

  const labelW = 130;
  const pctW = 54;
  const barX = PAD + labelW;
  const barW = W - PAD * 2 - labelW - pctW;
  const maxPct = rows[0]?.pct || 1;

  // Sin regla superior ni inferior: esta tarjeta se apila bajo la de métricas,
  // que ya cierra con una hairline. Dos reglas juntas leen como ruido.
  let body = `  <text x="${PAD}" y="36" font-family="${FONT}" font-size="11" font-weight="500" fill="${theme.muted}" letter-spacing="0.9">${esc(t.langsTitle.toUpperCase())}</text>\n`;
  body += `  <text x="${W - PAD}" y="36" text-anchor="end" font-family="${MONO}" font-size="10" fill="${theme.muted}">${esc(t.langsNote(data.repoCount))}</text>\n`;

  rows.forEach((row, i) => {
    const y = startY + i * rowH;
    // Escala relativa al lenguaje dominante: con un 74% arriba, una escala
    // absoluta 0-100 aplasta todo lo demás hasta hacerlo ilegible.
    const w = Math.max(2, (row.pct / maxPct) * barW);
    body += `  <text x="${PAD}" y="${y + 4}" font-family="${FONT}" font-size="13" fill="${theme.ink}">${esc(row.name)}</text>\n`;
    body += `  <rect x="${barX}" y="${y - 5}" width="${barW}" height="6" rx="3" fill="${theme.track}"/>\n`;
    body += `  <rect x="${barX}" y="${y - 5}" width="${w.toFixed(1)}" height="6" rx="3" fill="${theme.bar}"/>\n`;
    body += `  <text x="${W - PAD}" y="${y + 4}" text-anchor="end" font-family="${MONO}" font-size="12" fill="${theme.muted}">${row.pct.toFixed(1)}%</text>\n`;
  });

  return shell(W, height, theme, body);
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

const data = await collect();
const includePrivate = data.restricted > 0;
if (!includePrivate) {
  console.warn(
    'Aviso: el token no expone contribuciones privadas. Se omite esa métrica. ' +
      'Añade un PAT con read:user como secreto STATS_TOKEN para incluirla.',
  );
}

const now = new Date();
await mkdir(OUT, { recursive: true });

for (const locale of ['es', 'en']) {
  const stamp = `${now.getUTCDate()} ${COPY[locale].months[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
  for (const [mode, theme] of Object.entries(THEMES)) {
    await writeFile(
      join(OUT, `stats-${locale}-${mode}.svg`),
      metricsCard({ data, theme, locale, stamp, includePrivate }),
      'utf8',
    );
    await writeFile(
      join(OUT, `langs-${locale}-${mode}.svg`),
      languagesCard({ data, theme, locale }),
      'utf8',
    );
  }
}

console.log(
  `OK · ${data.contributions} contribuciones · ${data.mergedPrs} PRs · ${data.repoCount} repos · ${data.languages.size} lenguajes`,
);
