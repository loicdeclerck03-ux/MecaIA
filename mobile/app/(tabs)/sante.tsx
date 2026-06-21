// app/(tabs)/sante.tsx — Health Score + alertes OBD
import { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { authedFetch, supabase } from '../../lib/supabase';
import { COLORS } from '../_layout';

type Alert = { type: string; label: string; message: string; days_ahead?: number };

export default function SanteScreen() {
  const [score, setScore] = useState(70);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [vehicleName, setVehicleName] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      // Véhicule principal
      const { data: v } = await supabase.from('user_vehicles').select('marque,modele,annee,id').eq('is_primary', true).single();
      if (v) setVehicleName(`${v.marque} ${v.modele} ${v.annee}`);

      // Score et alertes depuis analyse_trends
      const r = await authedFetch('analyse_trends', {
        method: 'POST',
        body: JSON.stringify({ vehicle_id: v?.id || null }),
      });
      const data = await r.json();
      if (data.health_score !== undefined) setScore(data.health_score);
      if (data.alerts) setAlerts(data.alerts);
    } catch (e) {
      // Fallback score base
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const scoreColor = score >= 80 ? '#22c55e' : score >= 60 ? COLORS.accent : '#ef4444';
  const scoreLabel = score >= 90 ? 'Excellente condition' : score >= 75 ? 'Très bonne condition' : score >= 60 ? 'Entretien conseillé' : score >= 40 ? 'Attention requise' : 'Intervention urgente';

  function AlertCard({ a }: { a: Alert }) {
    const color = a.type === 'CRITICAL' ? '#ef4444' : a.type === 'WARNING' ? '#f97316' : COLORS.accent;
    const icon = a.type === 'CRITICAL' ? '🔴' : a.type === 'WARNING' ? '🟡' : '📈';
    return (
      <View style={[styles.alertCard, { borderLeftColor: color }]}>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 3 }}>
          <Text style={{ fontSize: 13 }}>{icon}</Text>
          <Text style={[styles.alertTitle, { color }]}>{a.label}</Text>
        </View>
        <Text style={styles.alertMsg}>{a.message}</Text>
        {a.days_ahead && <Text style={styles.alertDays}>dans ~{a.days_ahead} jours</Text>}
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Santé véhicule</Text>
        {vehicleName ? <Text style={styles.headerSub}>{vehicleName}</Text> : null}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={COLORS.accent} />
      ) : (
        <>
          {/* Score hero */}
          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>INDICE DE SANTÉ</Text>
            <Text style={[styles.scoreNum, { color: scoreColor }]}>{score}</Text>
            <Text style={styles.scoreSubLabel}>{scoreLabel}</Text>
            <TouchableOpacity style={styles.refreshBtn} onPress={load}>
              <Text style={styles.refreshBtnText}>↻ Actualiser</Text>
            </TouchableOpacity>
          </View>

          {/* Alertes */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {alerts.length > 0 ? `⚠️ ${alerts.length} alerte${alerts.length > 1 ? 's' : ''}` : '✅ Aucune alerte'}
            </Text>
            {alerts.map((a, i) => <AlertCard key={i} a={a} />)}
            {alerts.length === 0 && (
              <Text style={styles.noAlerts}>Votre véhicule ne présente pas d'anomalie détectée. Continuez à conduire !</Text>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  headerTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  headerSub: { fontSize: 12, color: COLORS.muted, marginTop: 1 },
  scoreCard: { margin: 16, backgroundColor: '#0d1f35', borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 0.5, borderColor: COLORS.border },
  scoreLabel: { fontSize: 10, color: 'rgba(255,255,255,.4)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 },
  scoreNum: { fontSize: 72, fontWeight: '300', lineHeight: 80 },
  scoreSubLabel: { fontSize: 14, color: COLORS.text, marginTop: 4, marginBottom: 16 },
  refreshBtn: { backgroundColor: 'rgba(255,255,255,.06)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  refreshBtnText: { fontSize: 12, color: COLORS.muted },
  section: { padding: 16, gap: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: COLORS.text, marginBottom: 4 },
  alertCard: { backgroundColor: COLORS.card, borderWidth: 0.5, borderColor: COLORS.border, borderLeftWidth: 3, borderRadius: 10, padding: 12 },
  alertTitle: { fontSize: 13, fontWeight: '600', flex: 1 },
  alertMsg: { fontSize: 12, color: COLORS.muted, lineHeight: 18 },
  alertDays: { fontSize: 11, color: COLORS.accent, marginTop: 4 },
  noAlerts: { fontSize: 13, color: COLORS.muted, lineHeight: 20 },
});
