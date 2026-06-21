// app/(tabs)/obd.tsx — OBD Connection Screen
import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { COLORS } from '../_layout';

type LivePid = { key: string; label: string; unit: string; value: string | null };

const PIDS: LivePid[] = [
  { key: 'RPM', label: 'Régime', unit: 'tr/min', value: null },
  { key: 'SPEED', label: 'Vitesse', unit: 'km/h', value: null },
  { key: 'COOLANT', label: 'Refroid.', unit: '°C', value: null },
  { key: 'BATTERY', label: 'Batterie', unit: 'V', value: null },
  { key: 'ENGINE_LOAD', label: 'Charge', unit: '%', value: null },
  { key: 'LTFT', label: 'LTFT B1', unit: '%', value: null },
  { key: 'MAF', label: 'MAF', unit: 'g/s', value: null },
  { key: 'INTAKE_MAP', label: 'Boost', unit: 'kPa', value: null },
];

export default function OBDScreen() {
  const [connected, setConnected] = useState(false);
  const [pids, setPids] = useState<LivePid[]>(PIDS);
  const [dtcs, setDtcs] = useState<string[]>([]);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>OBD2 Live</Text>
        <View style={[styles.statusDot, { backgroundColor: connected ? '#22c55e' : '#4a5568' }]} />
      </View>

      {/* Connection card */}
      <View style={styles.connCard}>
        <Text style={styles.connIcon}>{connected ? '🔌' : '📡'}</Text>
        <Text style={styles.connTitle}>{connected ? 'Connecté' : 'Non connecté'}</Text>
        <Text style={styles.connSub}>
          {connected
            ? 'OBD2 actif — données en temps réel'
            : 'Branchez le boitier MecaIA dans le port OBD2\n(sous le tableau de bord, côté conducteur)'}
        </Text>
        <TouchableOpacity
          style={[styles.connBtn, connected && styles.connBtnActive]}
          onPress={() => setConnected(!connected)}
        >
          <Text style={[styles.connBtnText, connected && { color: '#000' }]}>
            {connected ? '⏹ Déconnecter' : '▶ Connecter via Bluetooth'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Live PIDs grid */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Données live</Text>
        <View style={styles.pidsGrid}>
          {pids.map(p => (
            <View key={p.key} style={[styles.pidCard, !connected && { opacity: 0.4 }]}>
              <Text style={styles.pidVal}>{p.value ?? '—'}</Text>
              <Text style={styles.pidUnit}>{p.unit}</Text>
              <Text style={styles.pidLabel}>{p.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* DTC codes */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Codes défaut (DTC)</Text>
        {!connected ? (
          <Text style={styles.noConn}>Connectez l'OBD2 pour lire les codes</Text>
        ) : dtcs.length === 0 ? (
          <View style={styles.noDtc}>
            <Text style={{ fontSize: 28 }}>✅</Text>
            <Text style={styles.noDtcText}>Aucun code défaut actif</Text>
          </View>
        ) : (
          dtcs.map(d => (
            <View key={d} style={styles.dtcCard}>
              <Text style={styles.dtcCode}>{d}</Text>
            </View>
          ))
        )}
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 56, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  headerTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  connCard: { margin: 16, backgroundColor: COLORS.card, borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 0.5, borderColor: COLORS.border },
  connIcon: { fontSize: 36, marginBottom: 8 },
  connTitle: { fontSize: 17, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  connSub: { fontSize: 13, color: COLORS.muted, textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  connBtn: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: COLORS.accent, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
  connBtnActive: { backgroundColor: COLORS.accent },
  connBtnText: { color: COLORS.accent, fontWeight: '700', fontSize: 14 },
  section: { paddingHorizontal: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: COLORS.muted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 },
  pidsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pidCard: { width: '47%', backgroundColor: COLORS.card, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.border },
  pidVal: { fontSize: 22, fontWeight: '300', color: COLORS.accent, lineHeight: 28 },
  pidUnit: { fontSize: 10, color: COLORS.muted, marginBottom: 4 },
  pidLabel: { fontSize: 12, color: COLORS.muted },
  noConn: { fontSize: 13, color: COLORS.muted, textAlign: 'center', padding: 20 },
  noDtc: { alignItems: 'center', padding: 20, gap: 8 },
  noDtcText: { fontSize: 14, color: COLORS.muted },
  dtcCard: { backgroundColor: '#1a0a0a', borderWidth: 0.5, borderColor: '#e8a000', borderRadius: 8, padding: 12, marginBottom: 8 },
  dtcCode: { fontSize: 16, fontWeight: '700', color: COLORS.accent, fontFamily: 'monospace' },
});
