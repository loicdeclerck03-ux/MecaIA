'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const TOKEN = process.env.SENTRY_AUTH_TOKEN;
const ORG   = process.env.SENTRY_ORG   || 'loic-declerck';
const PROJ  = process.env.SENTRY_PROJECT || 'mecaia';
const BASE  = 'https://de.sentry.io/api/0';

if (!TOKEN) { process.stderr.write('[sentry-mcp] ERREUR: SENTRY_AUTH_TOKEN requis dans .env\n'); process.exit(1); }

async function sentryFetch(path) {
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error('Sentry API ' + r.status + ': ' + await r.text());
  return r.json();
}

function ok(data) { return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }; }
function err(msg) { return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true }; }

const server = new McpServer({ name: 'sentry-mcp-server', version: '1.0.0' });
server.registerTool('sentry_get_issues', {
  title: 'Issues Sentry actives',
  description: 'Retourne les issues Sentry actives pour MecaIA. Filtre par niveau: critical/error/warning. Indispensable au début de chaque session CTO.',
  inputSchema: {
    level: z.enum(['critical','error','warning','all']).default('error').describe('Niveau minimum'),
    limit: z.number().int().min(1).max(50).default(25)
  },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ level, limit }) => {
  try {
    const q = level === 'all' ? '' : '&level=' + level;
    const data = await sentryFetch('/organizations/' + ORG + '/issues/?project=' + PROJ + '&limit=' + limit + q + '&is_unresolved=true');
    const issues = Array.isArray(data) ? data : (data.data || []);
    const summary = issues.map(i => ({
      id: i.id, title: i.title, level: i.level, count: i.count,
      firstSeen: i.firstSeen, lastSeen: i.lastSeen, status: i.status
    }));
    return ok({ total: summary.length, issues: summary });
  } catch(e) { return err(e.message); }
});

server.registerTool('sentry_get_issue_detail', {
  title: 'Détail issue Sentry',
  description: 'Retourne le détail complet d\'une issue Sentry: stack trace, contexte, événements récents.',
  inputSchema: { issue_id: z.string().describe('ID de l\'issue Sentry') },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ issue_id }) => {
  try {
    const [issue, events] = await Promise.all([
      sentryFetch('/issues/' + issue_id + '/'),
      sentryFetch('/issues/' + issue_id + '/events/?limit=3')
    ]);
    return ok({ issue, recent_events: events });
  } catch(e) { return err(e.message); }
});

server.registerTool('sentry_get_stats', {
  title: 'Statistiques Sentry MecaIA',
  description: 'Retourne les stats d\'erreurs Sentry: nombre d\'issues, events/24h, trend. Pour le rapport CTO.',
  inputSchema: {
    period: z.enum(['1h','24h','7d','30d']).default('24h').describe('Période')
  },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ period }) => {
  try {
    const issues = await sentryFetch('/organizations/' + ORG + '/issues/?project=' + PROJ + '&limit=100&is_unresolved=true');
    const list = Array.isArray(issues) ? issues : (issues.data || []);
    const critical = list.filter(i => i.level === 'critical').length;
    const errors   = list.filter(i => i.level === 'error').length;
    const warnings = list.filter(i => i.level === 'warning').length;
    return ok({
      period, org: ORG, project: PROJ,
      summary: { total_unresolved: list.length, critical, errors, warnings },
      status: critical > 0 ? '🔴 CRITIQUE' : errors > 0 ? '🟡 ERREURS' : '🟢 OK',
      top_issues: list.slice(0,5).map(i => ({ title: i.title, level: i.level, count: i.count, lastSeen: i.lastSeen }))
    });
  } catch(e) { return err(e.message); }
});

server.registerTool('sentry_resolve_issue', {
  title: 'Résoudre une issue Sentry',
  description: 'Marque une issue Sentry comme résolue. Utiliser après avoir déployé un fix.',
  inputSchema: { issue_id: z.string().describe('ID de l\'issue à résoudre') },
  annotations: { readOnlyHint: false, destructiveHint: false }
}, async ({ issue_id }) => {
  try {
    const r = await fetch(BASE + '/issues/' + issue_id + '/', {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' })
    });
    if (!r.ok) throw new Error('Sentry ' + r.status);
    return ok({ resolved: true, issue_id });
  } catch(e) { return err(e.message); }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[sentry-mcp] Démarré — org: ' + ORG + ' project: ' + PROJ + '\n');
}
main().catch(e => { process.stderr.write('[sentry-mcp] FATAL: ' + e.message + '\n'); process.exit(1); });