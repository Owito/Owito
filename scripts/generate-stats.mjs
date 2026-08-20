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

import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

/**
 * Lenguajes de marcado y de configuración que GitHub cuenta como "lenguaje" pero
 * que no dicen nada sobre lo que sé escribir. Se excluyen ANTES de calcular el
 * total, para que los porcentajes sumen sobre código real y no queden diluidos.
 */
const EXCLUDED_LANGUAGES = new Set(['HTML']);

const COPY = {
  es: {
    role: 'Arquitecto de Software · Senior Technical Lead',
    place: 'Bogotá, Colombia',
    statsTitle: 'Actividad',
    metrics: [
      'Contribuciones · 12 meses',
      'Pull requests integrados',
      'Repositorios propios',
      'Trabajo en repos privados',
    ],
    // Sin PAT solo se ven los repositorios públicos: cambia el rótulo, no el número.
    metricPublicRepos: 'Repositorios públicos',
    langsTitle: 'Distribución del código',
    langsNote: (n, pub) =>
      `${n} repositorios ${pub ? 'públicos' : 'propios'} · sin forks ni HTML`,
    updated: 'Actualizado',
    months: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  },
  en: {
    role: 'Software Architect · Senior Technical Lead',
    place: 'Bogotá, Colombia',
    statsTitle: 'Activity',
    metrics: [
      'Contributions · 12 months',
      'Pull requests merged',
      'Own repositories',
      'Work in private repos',
    ],
    metricPublicRepos: 'Public repositories',
    langsTitle: 'Code distribution',
    langsNote: (n, pub) =>
      `${n} ${pub ? 'public' : 'own'} repositories · forks and HTML excluded`,
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

/** Igual que `rest`, pero devuelve null en vez de romper si el token no llega. */
async function restOrNull(path) {
  try {
    return await rest(path);
  } catch {
    return null;
  }
}

/**
 * Los lenguajes se leen por REST y no por GraphQL: la conexión `languages`
 * dispara el límite de complejidad de la API y devuelve 503 de forma
 * sistemática para cuentas con muchos repositorios.
 */
/**
 * Lista los repositorios propios sin forks. Se intenta primero la vía
 * autenticada, que es la única que incluye los privados, y si el token no la
 * alcanza se cae a la vía pública.
 *
 * Deliberadamente NO se consulta `/user` para decidirlo. Ese endpoint lo
 * rechazan con 403 tanto el GITHUB_TOKEN de Actions como los PAT fine-grained,
 * y el permiso para leer el perfil no tiene nada que ver con el permiso para
 * listar repositorios: preguntarle a `/user` era diagnosticar con el termómetro
 * equivocado, y bastaba para tumbar la ejecución entera.
 */
async function listOwnRepos() {
  const routes = [
    (page) => `/user/repos?affiliation=owner&per_page=100&page=${page}`,
    (page) => `/users/${USERNAME}/repos?type=owner&per_page=100&page=${page}`,
  ];

  for (const route of routes) {
    const repos = [];
    let usable = true;
    for (let page = 1; page <= 10; page += 1) {
      const batch = await restOrNull(route(page));
      if (!Array.isArray(batch)) {
        usable = false;
        break;
      }
      repos.push(...batch.filter((r) => !r.fork));
      if (batch.length < 100) break;
    }
    if (usable) return repos;
  }

  return [];
}

async function collectLanguages() {
  const repos = await listOwnRepos();
  // La prueba honesta de si el token alcanza lo privado no es qué permiso dice
  // tener, sino si de hecho devolvió algún repositorio privado.
  const owned = repos.some((r) => r.private);

  const languages = new Map();
  for (const repo of repos) {
    const bytes = await restOrNull(`/repos/${repo.full_name}/languages`);
    for (const [name, size] of Object.entries(bytes || {})) {
      if (EXCLUDED_LANGUAGES.has(name)) continue;
      languages.set(name, (languages.get(name) || 0) + size);
    }
  }

  return { languages, repoCount: repos.length, seesPrivateRepos: owned };
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

  const { languages, repoCount, seesPrivateRepos } = await collectLanguages();
  const contributions = totals.user.contributionsCollection;

  return {
    contributions: contributions.contributionCalendar.totalContributions,
    restricted: contributions.restrictedContributionsCount,
    mergedPrs: totals.user.pullRequests.totalCount,
    repoCount,
    seesPrivateRepos,
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

/** Micro-etiqueta en versalitas con tracking amplio, el rótulo del folleto. */
function label(x, y, text, theme, { anchor = 'start', color } = {}) {
  return `  <text x="${x}" y="${y}" ${anchor === 'end' ? 'text-anchor="end" ' : ''}font-family="${FONT}" font-size="10" font-weight="500" fill="${color || theme.muted}" letter-spacing="2.4">${esc(String(text).toUpperCase())}</text>\n`;
}

/**
 * Cabecera de sección: rótulo a la izquierda y una regla fina que corre hasta el
 * borde derecho. Es el motivo "PROJECT 01 ————" de la referencia.
 */
function sectionHead(y, text, theme, trailing) {
  const textW = String(text).length * 7.4 + 18;
  let out = label(PAD, y, text, theme);
  const ruleEnd = trailing ? W - PAD - (String(trailing).length * 5.6 + 14) : W - PAD;
  out += `  <line x1="${PAD + textW}" y1="${y - 4}" x2="${ruleEnd}" y2="${y - 4}" stroke="${theme.rule}" stroke-width="1"/>\n`;
  if (trailing) {
    out += `  <text x="${W - PAD}" y="${y}" text-anchor="end" font-family="${MONO}" font-size="10" fill="${theme.muted}">${esc(trailing)}</text>\n`;
  }
  return out;
}

/** Portada: el nombre en display ligero y muy tracked, todo en escala de grises. */
function coverCard({ theme, locale }) {
  const t = COPY[locale];
  const height = 150;

  let body = `  <line x1="${PAD}" y1="18" x2="${W - PAD}" y2="18" stroke="${theme.rule}" stroke-width="1"/>\n`;
  body += `  <text x="${PAD}" y="82" font-family="${FONT}" font-size="46" font-weight="300" fill="${theme.ink}" letter-spacing="9">CARLOS G</text>\n`;
  body += label(PAD, 110, t.role, theme);
  body += `  <text x="${W - PAD}" y="82" text-anchor="end" font-family="${MONO}" font-size="10" fill="${theme.muted}">${esc(t.place)}</text>\n`;
  body += `  <text x="${W - PAD}" y="110" text-anchor="end" font-family="${MONO}" font-size="10" fill="${theme.muted}">github.com/${esc(USERNAME)}</text>\n`;
  body += `  <line x1="${PAD}" y1="132" x2="${W - PAD}" y2="132" stroke="${theme.rule}" stroke-width="1"/>\n`;

  return shell(W, height, theme, body);
}

/**
 * Métricas como el índice del folleto: número de orden, rótulo en versalitas,
 * valor alineado a la derecha y una hairline cerrando cada fila.
 */
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

  // Sin PAT no hay dato de repos privados: se omite la fila en vez de mentir.
  const count = includePrivate ? 4 : 3;
  const rowH = 46;
  const startY = 62;
  // Se mide desde la última hairline y no desde el número de filas: así el aire
  // de cierre es constante y no crece con cada fila añadida.
  const height = startY + (count - 1) * rowH + 22 + 14;

  let body = sectionHead(28, t.statsTitle, theme, `${t.updated} ${stamp}`);

  for (let i = 0; i < count; i += 1) {
    const y = startY + i * rowH;
    body += `  <text x="${PAD}" y="${y}" font-family="${MONO}" font-size="10" fill="${theme.muted}">${String(i + 1).padStart(2, '0')}</text>\n`;
    const metric = i === 2 && !data.seesPrivateRepos ? t.metricPublicRepos : t.metrics[i];
    body += label(PAD + 42, y, metric, theme, { color: theme.ink });
    body += `  <text x="${W - PAD}" y="${y + 6}" text-anchor="end" font-family="${FONT}" font-size="30" font-weight="300" fill="${theme.ink}" letter-spacing="-0.4">${esc(values[i])}</text>\n`;
    body += `  <line x1="${PAD}" y1="${y + 22}" x2="${W - PAD}" y2="${y + 22}" stroke="${theme.rule}" stroke-width="1"/>\n`;
  }

  return shell(W, height, theme, body);
}

/**
 * Lenguajes: la barra se dibuja SOBRE la hairline de la fila, así que el mismo
 * trazo hace de separador y de escala. Un elemento menos que un track aparte.
 */
function languagesCard({ data, theme, locale, top = 6 }) {
  const t = COPY[locale];
  const entries = [...data.languages.entries()].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, size]) => sum + size, 0) || 1;
  const rows = entries.slice(0, top).map(([name, size]) => ({
    name,
    pct: (size / total) * 100,
  }));

  const rowH = 34;
  const startY = 66;
  const height = startY + (rows.length - 1) * rowH + 18;

  const barX = PAD + 150;
  const barW = W - PAD * 2 - 150 - 66;
  const maxPct = rows[0]?.pct || 1;

  let body = sectionHead(28, t.langsTitle, theme, t.langsNote(data.repoCount, !data.seesPrivateRepos));

  rows.forEach((row, i) => {
    const y = startY + i * rowH;
    // Escala relativa al lenguaje dominante: con un 74% arriba, una escala
    // absoluta 0-100 aplasta todo lo demás hasta hacerlo ilegible. La
    // proporción entre barras se conserva porque el origen sigue siendo cero.
    const w = Math.max(3, (row.pct / maxPct) * barW);
    body += `  <text x="${PAD}" y="${y + 4}" font-family="${FONT}" font-size="13" font-weight="400" fill="${theme.ink}">${esc(row.name)}</text>\n`;
    body += `  <line x1="${barX}" y1="${y}" x2="${barX + barW}" y2="${y}" stroke="${theme.rule}" stroke-width="1"/>\n`;
    body += `  <rect x="${barX}" y="${y - 2}" width="${w.toFixed(1)}" height="4" fill="${theme.bar}"/>\n`;
    body += `  <text x="${W - PAD}" y="${y + 4}" text-anchor="end" font-family="${MONO}" font-size="11" fill="${theme.muted}">${row.pct.toFixed(1)}%</text>\n`;
  });

  return shell(W, height, theme, body);
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

const data = await collect();
const includePrivate = data.restricted > 0;

/*
 * Salvaguarda. El GITHUB_TOKEN de Actions solo alcanza lo público: con él las
 * cifras no se quedan viejas, se DESINFLAN (los repositorios propios pasan de
 * 87 a los 26 públicos y el reparto de lenguajes se recalcula sobre una muestra
 * distinta). Publicar eso sería peor que no publicar nada, así que aquí el
 * proceso se detiene sin tocar las tarjetas ya generadas.
 */
if (!data.seesPrivateRepos || !includePrivate) {
  // Diagnóstico: sin esto, "el token no alcanza" no distingue entre un secreto
  // vacío, un PAT fine-grained (que nunca trae scopes) y uno al que le falta un
  // permiso. Solo se imprime la CABECERA de scopes, nunca el token.
  // El techo de cuota delata el tipo de token: 1000/h es el GITHUB_TOKEN de
  // Actions (o sea, el secreto llegó vacío y `||` cayó al fallback) y 5000/h es
  // un PAT de verdad al que le falta un permiso. Son arreglos distintos.
  const probe = await fetch('https://api.github.com/rate_limit', { headers: HEADERS })
    .then(async (r) => ({
      status: r.status,
      scopes: r.headers.get('x-oauth-scopes'),
      limit: r.headers.get('x-ratelimit-limit'),
    }))
    .catch((e) => ({ status: `error: ${e.message}`, scopes: null, limit: null }));

  for (const line of [
    'AVISO: este token solo ve la actividad pública, así que las tarjetas se',
    'dejan como están para no publicar cifras a la baja.',
    `  · repositorios propios vistos  ${data.repoCount} (ninguno privado)`,
    `  · contribuciones privadas      ${data.restricted}`,
    `  · cuota por hora               ${probe.limit} (HTTP ${probe.status})`,
    `  · scopes del token             ${probe.scopes || '(ninguno: es un PAT fine-grained o el GITHUB_TOKEN de Actions)'}`,
    probe.limit === '1000'
      ? 'Diagnóstico: es el GITHUB_TOKEN de Actions, o sea que el secreto STATS_TOKEN llegó vacío.'
      : 'Diagnóstico: es un PAT, pero no le llega a los repositorios privados.',
    'Arreglo: si el PAT es fine-grained, dale "Repository access: All repositories"',
    'y el permiso "Repository permissions → Metadata: Read-only". Si prefieres el',
    'camino corto, un PAT clásico con `repo` funciona sin más ajustes:',
    '  https://github.com/settings/tokens/new?scopes=repo,read:user',
    'El secreto se cambia en:',
    '  https://github.com/Owito/Owito/settings/secrets/actions',
  ]) {
    console.warn(line);
  }
  process.exit(0);
}

/**
 * La marca de tiempo cambia en cada ejecución, así que compararla haría que el
 * workflow publicara un commit por hora aunque ningún número se hubiera movido.
 * Se compara el SVG SIN la marca: el archivo solo se reescribe cuando los datos
 * cambian de verdad, y así "Actualizado" pasa a significar exactamente eso —
 * cuándo cambiaron estas cifras — en vez de cuándo corrió el cron.
 */
const STAMP = /(?:Actualizado|Updated)[^<]*/g;

async function writeIfChanged(file, content) {
  const path = join(OUT, file);
  const previous = await readFile(path, 'utf8').catch(() => null);
  if (previous && previous.replace(STAMP, '') === content.replace(STAMP, '')) return false;
  await writeFile(path, content, 'utf8');
  return true;
}

const now = new Date();
const hhmm = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
await mkdir(OUT, { recursive: true });

let written = 0;
for (const locale of ['es', 'en']) {
  const stamp = `${now.getUTCDate()} ${COPY[locale].months[now.getUTCMonth()]} ${now.getUTCFullYear()} · ${hhmm} UTC`;
  for (const [mode, theme] of Object.entries(THEMES)) {
    written += await writeIfChanged(`cover-${locale}-${mode}.svg`, coverCard({ theme, locale }));
    written += await writeIfChanged(
      `stats-${locale}-${mode}.svg`,
      metricsCard({ data, theme, locale, stamp, includePrivate }),
    );
    written += await writeIfChanged(
      `langs-${locale}-${mode}.svg`,
      languagesCard({ data, theme, locale }),
    );
  }
}

console.log(
  `OK · ${data.contributions} contribuciones · ${data.mergedPrs} PRs · ${data.repoCount} repos · ` +
    `${data.languages.size} lenguajes · ${written} tarjetas reescritas` +
    `${data.seesPrivateRepos ? '' : ' · solo repositorios públicos'}`,
);
