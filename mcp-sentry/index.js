'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const TOKEN = process.env.SENTRY_AUTH_TOKEN;
const ORG   = process.env.SENTRY_ORG   || 'loic-declerck';
const PROJ  = process.env.SENTRY_PROJECT || 'javascript';
const BASE  = 'https://de.sentry.io/api/0';

if (!TOKEN) { process.stderr.write('[sentry-mcp] ERREUR: SENTRY_AUTH_TOKEN requis dans .env\n'); process.exit(1); }

async function sentryFetch(path) {
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } });
  const text = await r.text();
  if (!r.ok) {
    if (r.status === 403) throw new Error('Scope insuffisant — créer un token avec event:read project:read sur https://loic-declerck.sentry.io/settings/auth-tokens/');
    throw new Error('Sentry API ' + r.status + ': ' + text);
  }
  return text ? JSON.parse(text) : {};
}

function ok(data) { return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }; }
function err(msg) { return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true }; }

const server = new McpServer({ name: 'sentry-mcp-server', version: '1.0.0' });

server.registerTool('sentry_get_releases', {
  title: 'Releases MecaIA',
  description: 'Retourne les releases Sentry de MecaIA avec stats d\'erreurs. Accessible avec le token actuel.',
  inputSchema: { limit: z.number().int().min(1).max(25).default(5) },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ limit }) => {
  try {
    const data = await sentryFetch('/organizations/' + ORG + '/releases/?limit=' + limit);
    const releases = Array.isArray(data) ? data : (data.data || []);
    const summary = releases.map(r => ({
      version: r.version, newGroups: r.newGroups, firstEvent: r.firstEvent,
      lastEvent: r.lastEvent, status: r.status
    }));
    const totalErrors = summary.reduce((s, r) => s + (r.newGroups || 0), 0);
    return ok({ total_errors_all_releases: totalErrors, releases: summary,
      note: totalErrors === 0 ? '🟢 Aucune erreur en prod — excellent !' : '⚠️ ' + totalErrors + ' groupes d\'erreurs'
    });
  } catch(e) { return err(e.message); }
});

server.registerTool('sentry_get_issues', {
  title: 'Issues Sentry actives',
  description: 'Retourne les issues actives. Nécessite un token avec event:read scope. Si 403, créer un nouveau token sur https://loic-declerck.sentry.io/settings/auth-tokens/',
  inputSchema: { level: z.enum(['error','warning','all']).default('error'), limit: z.number().int().min(1).max(50).default(25) },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ level, limit }) => {
  try {
    const q = level === 'all' ? '' : '&level=' + level;
    const data = await sentryFetch('/organizations/' + ORG + '/issues/?project=' + PROJ + '&limit=' + limit + q + '&is_unresolved=true');
    const issues = Array.isArray(data) ? data : (data.data || []);
    return ok({ total: issues.length, issues: issues.map(i => ({ id: i.id, title: i.title, level: i.level, count: i.count, lastSeen: i.lastSeen })) });
  } catch(e) { return err(e.message + ' — Créer token: https://loic-declerck.sentry.io/settings/auth-tokens/'); }
});

server.registerTool('sentry_get_stats', {
  title: 'Statistiques Sentry MecaIA',
  description: 'Stats d\'erreurs et état production MecaIA. Utilise les releases (toujours accessibles).',
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async () => {
  try {
    const releases = await sentryFetch('/organizations/' + ORG + '/releases/?limit=1');
    const latest = Array.isArray(releases) ? releases[0] : null;
    const totalNewGroups = latest?.newGroups || 0;
    return ok({
      org: ORG, project: PROJ,
      latest_release: latest?.version || 'N/A',
      errors_in_release: totalNewGroups,
      last_event: latest?.lastEvent || null,
      status: totalNewGroups === 0 ? '🟢 OK — 0 nouvelles erreurs' : '🟡 ' + totalNewGroups + ' erreurs',
      note: 'Pour les détails issues: créer token avec event:read sur https://loic-declerck.sentry.io/settings/auth-tokens/'
    });
  } catch(e) { return err(e.message); }
});

server.registerTool('sentry_resolve_issue', {
  title: 'Résoudre une issue Sentry',
  description: 'Marque une issue comme résolue. Nécessite un token avec event:write scope.',
  inputSchema: { issue_id: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: false }
}, async ({ issue_id }) => {
  try {
    const r = await fetch(BASE + '/issues/' + issue_id + '/', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' })
    });
    if (!r.ok) throw new Error('Sentry ' + r.status + ' — token event:write requis');
    return ok({ resolved: true, issue_id });
  } catch(e) { return err(e.message); }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[sentry-mcp] Démarré — org: ' + ORG + ' — token scope: releases (limited)\n');
}
main().catch(e => { process.stderr.write('[sentry-mcp] FATAL: ' + e.message + '\n'); process.exit(1); });