// app/(tabs)/garage.tsx — Garage Screen (liste véhicules)
import { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  Alert, ActivityIndicator, TextInput, Modal,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../_layout';

type Vehicle = { id: string; marque: string; modele: string; annee: number; carburant?: string; km?: number; is_primary?: boolean };

export default function GarageScreen() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newVeh, setNewVeh] = useState({ marque: '', modele: '', annee: '', carburant: 'Diesel', km: '' });
  const [saving, setSaving] = useState(false);

  const loadVehicles = async () => {
    setLoading(true);
    const { data } = await supabase.from('user_vehicles').select('*').order('created_at', { ascending: true });
    setVehicles(data || []);
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { loadVehicles(); }, []));

  async function setPrimary(id: string) {
    await supabase.from('user_vehicles').update({ is_primary: false }).neq('id', 'dummy');
    await supabase.from('user_vehicles').update({ is_primary: true }).eq('id', id);
    loadVehicles();
  }

  async function addVehicle() {
    if (!newVeh.marque || !newVeh.modele || !newVeh.annee) {
      Alert.alert('Erreur', 'Marque, modèle et année requis'); return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('user_vehicles').insert({
      user_id: user?.id,
      marque: newVeh.marque.toUpperCase(),
      modele: newVeh.modele,
      annee: parseInt(newVeh.annee),
      carburant: newVeh.carburant,
      km: newVeh.km ? parseInt(newVeh.km) : null,
      is_primary: vehicles.length === 0,
    });
    setSaving(false);
    setShowAdd(false);
    setNewVeh({ marque: '', modele: '', annee: '', carburant: 'Diesel', km: '' });
    loadVehicles();
  }

  function VehicleCard({ v }: { v: Vehicle }) {
    return (
      <TouchableOpacity style={[styles.card, v.is_primary && styles.cardPrimary]} onPress={() => setPrimary(v.id)}>
        <View style={styles.cardLeft}>
          <Text style={styles.vehEmoji}>🚗</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.vehName}>{v.marque} {v.modele}</Text>
          <Text style={styles.vehSub}>{v.annee}{v.carburant ? ` · ${v.carburant}` : ''}{v.km ? ` · ${v.km.toLocaleString()}km` : ''}</Text>
        </View>
        {v.is_primary && (
          <View style={styles.primaryBadge}><Text style={styles.primaryText}>Actif</Text></View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Mon Garage</Text>
          <Text style={styles.headerSub}>{vehicles.length} véhicule{vehicles.length !== 1 ? 's' : ''}</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
          <Text style={{ fontSize: 20, color: '#000' }}>+</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={COLORS.accent} />
      ) : vehicles.length === 0 ? (
        <View style={styles.empty}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>🚗</Text>
          <Text style={styles.emptyTitle}>Pas encore de véhicule</Text>
          <Text style={styles.emptySub}>Ajoutez votre voiture pour commencer un diagnostic</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowAdd(true)}>
            <Text style={styles.emptyBtnText}>Ajouter un véhicule</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={vehicles}
          keyExtractor={v => v.id}
          renderItem={({ item }) => <VehicleCard v={item} />}
          contentContainerStyle={{ padding: 16, gap: 10 }}
        />
      )}

      {/* Modal ajout véhicule */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.container, { padding: 24 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text }}>Ajouter un véhicule</Text>
            <TouchableOpacity onPress={() => setShowAdd(false)}>
              <Text style={{ color: COLORS.muted, fontSize: 16 }}>✕ Fermer</Text>
            </TouchableOpacity>
          </View>
          {(['marque','modele','annee','km'] as const).map(field => (
            <View key={field} style={{ marginBottom: 14 }}>
              <Text style={styles.label}>{field === 'km' ? 'Kilométrage' : field.charAt(0).toUpperCase() + field.slice(1)}</Text>
              <TextInput
                style={styles.input}
                value={newVeh[field]}
                onChangeText={v => setNewVeh(p => ({ ...p, [field]: v }))}
                placeholder={field === 'marque' ? 'BMW, Peugeot, Renault...' : field === 'annee' ? '2015' : field === 'km' ? '85000' : 'Série 3, 308...'}
                placeholderTextColor={COLORS.muted}
                keyboardType={field === 'annee' || field === 'km' ? 'numeric' : 'default'}
              />
            </View>
          ))}
          <TouchableOpacity style={styles.saveBtn} onPress={addVehicle} disabled={saving}>
            {saving ? <ActivityIndicator color="#000" /> : <Text style={styles.saveBtnText}>Enregistrer</Text>}
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 56, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  headerTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  headerSub: { fontSize: 12, color: COLORS.muted, marginTop: 1 },
  addBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: COLORS.card, borderWidth: 0.5, borderColor: COLORS.border, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardPrimary: { borderColor: COLORS.accent, borderWidth: 1 },
  cardLeft: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#0d1f35', alignItems: 'center', justifyContent: 'center' },
  vehEmoji: { fontSize: 20 },
  cardBody: { flex: 1 },
  vehName: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  vehSub: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  primaryBadge: { backgroundColor: 'rgba(232,160,0,.15)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  primaryText: { fontSize: 11, color: COLORS.accent, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  emptySub: { fontSize: 13, color: COLORS.muted, textAlign: 'center', marginBottom: 24 },
  emptyBtn: { backgroundColor: COLORS.accent, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnText: { color: '#000', fontWeight: '700', fontSize: 14 },
  label: { fontSize: 12, color: COLORS.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#0a0e12', borderWidth: 0.5, borderColor: COLORS.border, borderRadius: 10, padding: 12, fontSize: 14, color: COLORS.text },
  saveBtn: { backgroundColor: COLORS.accent, borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#000', fontWeight: '700', fontSize: 15 },
});
