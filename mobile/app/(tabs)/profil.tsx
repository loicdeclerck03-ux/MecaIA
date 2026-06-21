// app/(tabs)/profil.tsx — Profile + paramètres
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../_layout';
import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

export default function ProfilScreen() {
  const [user, setUser] = useState<any>(null);
  const [credits, setCredits] = useState(0);

  useFocusEffect(useCallback(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    supabase.from('user_credits').select('balance').single().then(({ data }) => {
      if (data) setCredits(data.balance || 0);
    });
  }, []));

  async function logout() {
    Alert.alert('Déconnexion', 'Voulez-vous vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déconnecter', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  const rows = [
    { icon: '📧', label: 'Email', value: user?.email || '—' },
    { icon: '💳', label: 'Crédits disponibles', value: `${credits} crédit${credits !== 1 ? 's' : ''}` },
    { icon: '📱', label: 'Version app', value: '1.0.0' },
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mon profil</Text>
      </View>

      {/* Avatar */}
      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.email?.[0]?.toUpperCase() || '?'}</Text>
        </View>
        <Text style={styles.email}>{user?.email}</Text>
      </View>

      {/* Info rows */}
      <View style={styles.section}>
        {rows.map(r => (
          <View key={r.label} style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={{ fontSize: 16, marginRight: 10 }}>{r.icon}</Text>
              <Text style={styles.rowLabel}>{r.label}</Text>
            </View>
            <Text style={styles.rowValue}>{r.value}</Text>
          </View>
        ))}
      </View>

      {/* Links */}
      <View style={styles.section}>
        {[
          { icon: '🏥', label: 'Rapport santé hebdomadaire', sub: 'Email automatique chaque lundi' },
          { icon: '🔔', label: 'Alertes OBD', sub: 'Notifications push activées' },
          { icon: '🔒', label: 'Confidentialité', sub: 'Données chiffrées, jamais revendues' },
        ].map(item => (
          <TouchableOpacity key={item.label} style={styles.linkRow}>
            <Text style={{ fontSize: 18 }}>{item.icon}</Text>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.linkLabel}>{item.label}</Text>
              <Text style={styles.linkSub}>{item.sub}</Text>
            </View>
            <Text style={{ color: COLORS.muted }}>›</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </TouchableOpacity>

      <Text style={styles.version}>MecaIA · mecaiaauto.com</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  headerTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  avatarSection: { alignItems: 'center', padding: 24 },
  avatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  avatarText: { fontSize: 28, fontWeight: '700', color: '#000' },
  email: { fontSize: 14, color: COLORS.muted },
  section: { marginHorizontal: 16, backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 0.5, borderColor: COLORS.border, marginBottom: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  rowLeft: { flexDirection: 'row', alignItems: 'center' },
  rowLabel: { fontSize: 13, color: COLORS.muted },
  rowValue: { fontSize: 13, color: COLORS.text, fontWeight: '500' },
  linkRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  linkLabel: { fontSize: 13, color: COLORS.text, fontWeight: '500' },
  linkSub: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  logoutBtn: { marginHorizontal: 16, marginTop: 8, backgroundColor: 'rgba(239,68,68,.1)', borderWidth: 0.5, borderColor: 'rgba(239,68,68,.3)', borderRadius: 12, padding: 14, alignItems: 'center' },
  logoutText: { color: '#ef4444', fontWeight: '600', fontSize: 14 },
  version: { textAlign: 'center', color: COLORS.muted, fontSize: 11, margin: 20 },
});
