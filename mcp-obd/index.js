'use strict';
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { OBD2, PIDS, MONITOR_PIDS } = require('./obd2.js');

let obd = null;
function getOBD() {
  if (!obd) {
    obd = new OBD2();
    obd.on('log', msg => process.stderr.write('[OBD] ' + msg + '\n'));
    obd.on('status', s => process.stderr.write('[OBD] ' + JSON.stringify(s) + '\n'));
  }
  return obd;
}
function ok(data) { return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }; }
function err(msg) { return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true }; }

const server = new McpServer({ name: 'obd-mcp-server', version: '1.0.0' });
// obd_list_ports
server.registerTool('obd_list_ports', {
  title: 'Lister ports COM',
  description: 'Liste les ports serie disponibles et identifie les ports OBD2 Bluetooth (ELM327/OBDLink/Vgate). Utiliser avant obd_connect.',
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async () => {
  try {
    const ports = await OBD2.listPorts();
    return ok({ ports, obd_ports: ports.filter(p => p.isOBD2) });
  } catch(e) { return err(e.message); }
});

// obd_connect
server.registerTool('obd_connect', {
  title: 'Connecter au boitier OBD2',
  description: 'Connecte au boitier ELM327/OBDLink MX+ via Bluetooth. Si port omis: auto-detect sur tous les COM. Retourne version ELM327 et etat vehicule.',
  inputSchema: { port: z.string().optional().describe('Port COM ex COM5 — omis = auto-detect') },
  annotations: { readOnlyHint: false, destructiveHint: false }
}, async ({ port }) => {
  try {
    const o = getOBD();
    if (o.connected) await o.disconnect();
    let targetPort = port;
    if (!targetPort) {
      const winner = await OBD2.autoConnect();
      if (!winner) return err('Aucun boitier OBD2 detecte. Verifiez Bluetooth et contact vehicule.');
      targetPort = winner.port;
    }
    await o.connect(targetPort);
    return ok({ connected: true, port: targetPort, version: o.elmVersion || 'ELM327', vehicleReady: o.vehicleReady });
  } catch(e) { return err('Connexion echouee: ' + e.message); }
});

// obd_disconnect
server.registerTool('obd_disconnect', {
  title: 'Deconnecter OBD2',
  description: 'Ferme proprement la connexion serie avec le boitier ELM327.',
  inputSchema: {},
  annotations: { readOnlyHint: false, destructiveHint: false }
}, async () => {
  const o = getOBD();
  if (!o.connected) return ok({ disconnected: true, message: 'Deja deconnecte' });
  await o.disconnect();
  return ok({ disconnected: true });
});

// obd_status
server.registerTool('obd_status', {
  title: 'Etat connexion OBD2',
  description: 'Retourne si le boitier est connecte, port utilise, version ELM327.',
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async () => {
  const o = getOBD();
  return ok({ connected: o.connected, port: o.portPath || null, version: o.elmVersion || null });
});
// obd_read_pid
server.registerTool('obd_read_pid', {
  title: 'Lire un PID moteur',
  description: 'Lit un PID OBD2 Mode 01 temps reel. PIDs: RPM SPEED COOLANT ENGINE_LOAD THROTTLE BATTERY MAF INTAKE_MAP INTAKE_TEMP OIL_TEMP FUEL_LEVEL FUEL_TRIM_ST FUEL_TRIM_LT O2_B1S1 O2_B1S2 TIMING BARO ETHANOL FUEL_RATE FUEL_RAIL_HP INJ_TIMING ABS_LOAD RUN_TIME MIL_DISTANCE',
  inputSchema: { pid: z.string().describe('Cle PID ex RPM COOLANT SPEED BATTERY') },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ pid }) => {
  const o = getOBD();
  if (!o.connected) return err('Non connecte. Utiliser obd_connect.');
  const key = pid.toUpperCase();
  if (!PIDS[key]) return err('PID inconnu: ' + key + '. Voir obd_list_pids.');
  try { return ok(await o.readPID(key)); } catch(e) { return err(e.message); }
});

// obd_read_monitor_pids
server.registerTool('obd_read_monitor_pids', {
  title: 'Lire parametres moteur principaux',
  description: 'Lit tous les PIDs de monitoring prioritaires en une operation: RPM, Vitesse, Coolant, Charge, Batterie, MAF, Pression, Sondes O2, EGR, Carburant diesel...',
  inputSchema: { pids: z.array(z.string()).optional().describe('PIDs specifiques — defaut: tous les PIDs monitoring') },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ pids }) => {
  const o = getOBD();
  if (!o.connected) return err('Non connecte. Utiliser obd_connect.');
  const keys = (pids || MONITOR_PIDS).map(k => k.toUpperCase());
  const results = {};
  for (const key of keys) {
    if (!PIDS[key]) continue;
    try { results[key] = await o.readPID(key); } catch(_) {}
    await new Promise(r => setTimeout(r, 40));
  }
  return ok(results);
});

// obd_read_dtc
server.registerTool('obd_read_dtc', {
  title: 'Lire codes defauts DTC',
  description: 'Lit les DTCs sur 3 modes: confirmes (Mode 03 MIL allume), en attente (Mode 07 pre-defauts), permanents (Mode 0A non effacables). Retourne confirmed/pending/permanent avec codes P/C/B/U.',
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async () => {
  const o = getOBD();
  if (!o.connected) return err('Non connecte. Utiliser obd_connect.');
  try {
    const [c, p, perm] = await Promise.allSettled([o.readDTCs(), o.readPendingDTCs(), o.readPermanentDTCs()]);
    const dtc = {
      confirmed: c.status === 'fulfilled' ? c.value : [],
      pending:   p.status === 'fulfilled' ? p.value : [],
      permanent: perm.status === 'fulfilled' ? perm.value : []
    };
    dtc.total = dtc.confirmed.length + dtc.pending.length + dtc.permanent.length;
    return ok(dtc);
  } catch(e) { return err(e.message); }
});

// obd_clear_dtc
server.registerTool('obd_clear_dtc', {
  title: 'Effacer codes defauts',
  description: 'Envoie Mode 04 pour effacer tous les DTCs et eteindre le MIL. ATTENTION: efface aussi les moniteurs readiness. Ne pas effacer sans avoir note et diagnostique les codes.',
  inputSchema: { confirm: z.boolean().describe('Doit etre true pour confirmer') },
  annotations: { readOnlyHint: false, destructiveHint: true }
}, async ({ confirm }) => {
  if (!confirm) return err('confirm=true requis pour effacer les DTCs.');
  const o = getOBD();
  if (!o.connected) return err('Non connecte. Utiliser obd_connect.');
  try {
    const cleared = await o.clearDTCs();
    return ok({ cleared, message: cleared ? 'DTCs effaces. Voyant MIL eteint.' : 'Effacement echoue.' });
  } catch(e) { return err(e.message); }
});
// obd_read_vehicle_info
server.registerTool('obd_read_vehicle_info', {
  title: 'Infos vehicule Mode 09',
  description: 'Lit VIN (17 caracteres), Calibration ID (version logiciel ECU), ECU Name via Mode 09.',
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async () => {
  const o = getOBD();
  if (!o.connected) return err('Non connecte. Utiliser obd_connect.');
  try {
    const [vin, calibId, ecuName] = await Promise.all([o.readVIN(), o.readCalibrationID(), o.readECUName()]);
    return ok({ vin, calibrationId: calibId, ecuName });
  } catch(e) { return err(e.message); }
});

// obd_read_readiness
server.registerTool('obd_read_readiness', {
  title: 'Moniteurs emissions readiness',
  description: 'Lit etat moniteurs OBD2 Mode 01 PID 01: MIL allume, nb DTCs, readiness catalyseur/O2/EVAP/EGR. Utile pour controle technique.',
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async () => {
  const o = getOBD();
  if (!o.connected) return err('Non connecte. Utiliser obd_connect.');
  try { return ok(await o.readReadinessMonitors()); } catch(e) { return err(e.message); }
});

// obd_read_freeze_frame
server.registerTool('obd_read_freeze_frame', {
  title: 'Freeze Frame Mode 02',
  description: 'Donnees moteur figees au moment du declenchement DTC: RPM, vitesse, charge, temperature au moment exact de la panne.',
  inputSchema: { dtc_index: z.number().int().min(0).max(3).default(0).describe('Index DTC 0=premier code') },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ dtc_index }) => {
  const o = getOBD();
  if (!o.connected) return err('Non connecte. Utiliser obd_connect.');
  try {
    const frame = await o.readFreezeFrame(dtc_index);
    return ok({ dtc_index, frame, empty: Object.keys(frame).length === 0 });
  } catch(e) { return err(e.message); }
});

// obd_full_scan
server.registerTool('obd_full_scan', {
  title: 'Scan diagnostic complet',
  description: 'Scan complet: VIN + ECU + DTCs confirmes/attente/permanents + moniteurs emissions + 30+ PIDs temps reel + Freeze Frames + Mode06 + sante batterie. Duree ~60-90s.',
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async () => {
  const o = getOBD();
  if (!o.connected) return err('Non connecte. Utiliser obd_connect.');
  try {
    const result = await o.fullDiagScan();
    const dtcTotal = (result.dtcs && result.dtcs.length || 0) + (result.pendingDtcs && result.pendingDtcs.length || 0);
    result._summary = {
      hasErrors: dtcTotal > 0,
      dtcTotal,
      milOn: result.monitors && result.monitors.milOn || false,
      vin: result.vin || 'Non lu',
      batteryOk: (result.batteryHealth && result.batteryHealth.voltage || 0) >= 11.5
    };
    return ok(result);
  } catch(e) { return err('Scan echoue: ' + e.message); }
});

// obd_list_pids
server.registerTool('obd_list_pids', {
  title: 'Lister tous les PIDs OBD2',
  description: 'Retourne la liste complete des PIDs Mode 01 avec label, unite et commande ELM327.',
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async () => {
  const list = Object.entries(PIDS).map(([key, def]) => ({ key, label: def.label, unit: def.unit, cmd: def.cmd }));
  return ok({ total: list.length, pids: list });
});

// Transport stdio
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[obd-mcp-server] Demarre\n');
}
main().catch(e => { process.stderr.write('[obd-mcp-server] FATAL: ' + e.message + '\n'); process.exit(1); });