// ── MecaIA Beta Agent System — lib/mecaia_client.mjs ──────────────────────
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = 'https://vexxjbpbfrvgszvzpmgu.supabase.co';
const SITE_URL      = 'https://mecaiaauto.com';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZleHhqYnBiZnJ2Z3N6dnpwbWd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NzU4NzksImV4cCI6MjA5NTU1MTg3OX0.T2owu6atANKHH7PfEUL-BG8F6MAizhsqZb3RQWJOR1U';

export class MecaIAClient {
  constructor(agent, supabase, session) {
    this.agent     = agent;
    this.supabase  = supabase;
    this.session   = session;
    this.token     = session?.access_token;
    this.userId    = session?.user?.id;
    this.vehicleId = null;
    this.sessionId = null;
    this.log       = [];
  }

  static async create(agent, maxRetries = 4) {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      if (i > 0) {
        const wait = (i + 1) * 3000;
        console.log(`  [login] retry ${i}/${maxRetries-1} dans ${wait/1000}s...`);
        await new Promise(r => setTimeout(r, wait));
      }
      const { data: signIn, error } = await sb.auth.signInWithPassword({
        email: agent.email, password: agent.password
      });
      if (!error && signIn?.session) return new MecaIAClient(agent, sb, signIn.session);
      lastError = error;
      // 522 Cloudflare = retryable, autres erreurs = abandon
      if (error?.status !== 522 && error?.status !== 503 && error?.status !== 504) break;
    }
    throw new Error(`Login echoue apres ${maxRetries} essais: ${lastError?.message || 'pas de session'} (${lastError?.status})`);
  }

  async call(endpoint, body = {}, method = 'POST') {
    const t0 = Date.now();
    let status = 0, data = null, error = null;
    try {
      const res = await fetch(`${SITE_URL}/.netlify/functions/${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
        body: method !== 'GET' ? JSON.stringify(body) : undefined
      });
      status = res.status;
      const txt = await res.text();
      try { data = JSON.parse(txt); } catch { data = { raw: txt.slice(0, 300) }; }
    } catch (e) { error = e.message; }
    const entry = { endpoint, status, ms: Date.now()-t0, ok: status>=200&&status<400, error, data };
    this.log.push(entry);
    return entry;
  }

  async getGarage()  { return this.call('garage_get', {}, 'GET'); }
  async getProfile() { return this.call('profile_get', {}, 'GET'); }
  async ctCheck()    {
    const v = this.agent.vehicle;
    return this.call('ct_check', { marque:v.marque, modele:v.modele, annee:v.annee, km:parseInt(v.km) });
  }

  async addVehicle(v) {
    const r = await this.call('garage_add_vehicle', {
      marque:v.marque, modele:v.modele, annee:v.annee, carbu:v.carbu, km:parseInt(v.km), nom:v.nom
    });
    if (r.ok && r.data?.vehicle?.id) this.vehicleId = r.data.vehicle.id;
    else if (r.ok && r.data?.data?.id) this.vehicleId = r.data.data.id;
    return r;
  }

  async dylanChat(message, history = []) {
    const v = this.agent.vehicle;
    const r = await this.call('dylan_agents', {
      session_id: this.sessionId, user_input: message,
      vehicle: { make:v.marque, model:v.modele, year:parseInt(v.annee), fuel:v.carbu, mileage_km:parseInt(v.km) },
      vehicle_marque:v.marque, vehicle_modele:v.modele, vehicle_km:parseInt(v.km), language:'fr',
      messages: history
    });
    if (r.ok && r.data?.session_id) this.sessionId = r.data.session_id;
    else if (r.ok && r.data?.data?.session_id) this.sessionId = r.data.data.session_id;
    return r;
  }

  async vinLookup(vin) { return this.call('vin_lookup', { vin }); }
  async partsSearch(q) {
    const v = this.agent.vehicle;
    return this.call('parts_search', { query:q, marque:v.marque, modele:v.modele, annee:v.annee });
  }
  async signOut() { await this.supabase.auth.signOut(); }
}
