// app/(tabs)/obd.tsx — OBD2 Screen avec useOBDBLE hook
import { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  ScrollView, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useOBDBLE } from '../../hooks/useOBDBLE';
import { authedFetch, supabase } from '../../lib/supabase';
import { COLORS } from '../_layout';

export default function OBDScreen() {
  const { state, devices, connectedDevice, liveData, dtcs, error, scanDevices, connect, disconnect, readDTCs } = useOBDBLE();
  const [activeTab, setActiveTab] = useState<'live'|'dtc'>('live');

  useFocusEffect(useCallback(() => {
    if(connectedDevice) readDTCs();
  }, [connectedDevice]));

  const LIVE_PIDS = [
    { key: 'RPM', emoji: '⚡' }, { key: 'SPEED', emoji: '🏎' },
    { key: 'COOLANT', emoji: '🌡' }, { key: 'BATTERY', emoji: '🔋' },
    { key: 'LTFT', emoji: '⛽' }, { key: 'MAF', emoji: '💨' },
  ];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>OBD2</Text>
          <Text style={styles.headerSub}>{connectedDevice ? connectedDevice.name : 'Non connecté'}</Text>
        </View>
        <View style={[styles.dot, { backgroundColor: state==='connected' ? '#22c55e' : state==='scanning'||state==='connecting' ? COLORS.accent : '#3d4f5f' }]} />
      </View>

      <ScrollView>
        {/* Connection panel */}
        {state !== 'connected' ? (
          <View style={styles.connPanel}>
            <Text style={{ fontSize: 40, textAlign:'center', marginBottom:8 }}>{state==='scanning'?'📡':'🔌'}</Text>
            <Text style={styles.connTitle}>{state==='scanning'?'Scan en cours...':state==='connecting'?'Connexion...':'Branchez le boitier OBD2'}</Text>
            {error ? <Text style={styles.err}>{error}</Text> : null}

            {state === 'idle' && (
              <TouchableOpacity style={styles.scanBtn} onPress={scanDevices}>
                <Text style={styles.scanBtnText}>🔍 Chercher un boitier</Text>
              </TouchableOpacity>
            )}
            {state === 'scanning' && <ActivityIndicator color={COLORS.accent} style={{marginTop:12}} />}
            {devices.length > 0 && state === 'idle' && (
              <View style={styles.deviceList}>
                {devices.map(d => (
                  <TouchableOpacity key={d.id} style={styles.deviceRow} onPress={() => connect(d)}>
                    <View>
                      <Text style={styles.deviceName}>{d.name}</Text>
                      <Text style={styles.deviceId}>{d.id} · {d.rssi} dBm</Text>
                    </View>
                    <Text style={{ color: COLORS.accent, fontSize:13 }}>Connecter →</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        ) : (
          <>
            {/* Tabs */}
            <View style={styles.tabs}>
              {(['live','dtc'] as const).map(tab => (
                <TouchableOpacity key={tab} style={[styles.tab, activeTab===tab&&styles.tabActive]} onPress={() => setActiveTab(tab)}>
                  <Text style={[styles.tabText, activeTab===tab&&{color:COLORS.accent}]}>
                    {tab==='live' ? '📊 Live' : `🔍 DTC${dtcs.length>0?` (${dtcs.length})`:''}`}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.disconnBtn} onPress={disconnect}>
                <Text style={{ color:'#ef4444', fontSize:12 }}>⏹ Déconnecter</Text>
              </TouchableOpacity>
            </View>

            {activeTab === 'live' ? (
              <View style={styles.pidsGrid}>
                {LIVE_PIDS.map(({key, emoji}) => {
                  const d = liveData[key];
                  return (
                    <View key={key} style={styles.pidCard}>
                      <Text style={styles.pidEmoji}>{emoji}</Text>
                      <Text style={styles.pidVal}>{d?.value ?? '—'}</Text>
                      <Text style={styles.pidUnit}>{d?.unit ?? ''}</Text>
                      <Text style={styles.pidLabel}>{d?.label ?? key}</Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={{padding:16}}>
                {dtcs.length === 0 ? (
                  <View style={{alignItems:'center', padding:32}}>
                    <Text style={{fontSize:36,marginBottom:8}}>✅</Text>
                    <Text style={{color:COLORS.text,fontWeight:'600',fontSize:15}}>Aucun code défaut</Text>
                    <Text style={{color:COLORS.muted,fontSize:12,marginTop:4}}>Votre véhicule ne présente pas d'erreur OBD active</Text>
                  </View>
                ) : dtcs.map(code => (
                  <View key={code} style={styles.dtcCard}>
                    <Text style={styles.dtcCode}>{code}</Text>
                    <TouchableOpacity style={styles.dtcAnalyze}>
                      <Text style={{color:COLORS.accent,fontSize:11,fontWeight:'600'}}>Analyser avec Dylan →</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
        <View style={{height:32}} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor: COLORS.bg },
  header: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingTop:56, paddingHorizontal:20, paddingBottom:14, borderBottomWidth:0.5, borderBottomColor:COLORS.border },
  headerTitle: { fontSize:20, fontWeight:'700', color:COLORS.text },
  headerSub: { fontSize:12, color:COLORS.muted, marginTop:1 },
  dot: { width:12, height:12, borderRadius:6 },
  connPanel: { margin:16, backgroundColor:COLORS.card, borderRadius:16, padding:24, borderWidth:0.5, borderColor:COLORS.border },
  connTitle: { fontSize:15, fontWeight:'600', color:COLORS.text, textAlign:'center', marginBottom:16 },
  err: { color:'#ef4444', fontSize:12, textAlign:'center', marginBottom:10 },
  scanBtn: { backgroundColor:COLORS.accent, borderRadius:10, padding:13, alignItems:'center' },
  scanBtnText: { color:'#000', fontWeight:'700', fontSize:14 },
  deviceList: { marginTop:16, gap:8 },
  deviceRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', backgroundColor:'rgba(255,255,255,.04)', borderRadius:10, padding:12 },
  deviceName: { fontSize:13, fontWeight:'600', color:COLORS.text },
  deviceId: { fontSize:10, color:COLORS.muted, marginTop:2 },
  tabs: { flexDirection:'row', alignItems:'center', borderBottomWidth:0.5, borderBottomColor:COLORS.border, paddingHorizontal:12 },
  tab: { paddingVertical:12, paddingHorizontal:16 },
  tabActive: { borderBottomWidth:2, borderBottomColor:COLORS.accent },
  tabText: { fontSize:13, color:COLORS.muted, fontWeight:'500' },
  disconnBtn: { marginLeft:'auto', padding:10 },
  pidsGrid: { flexDirection:'row', flexWrap:'wrap', padding:12, gap:8 },
  pidCard: { width:'30%', backgroundColor:COLORS.card, borderRadius:12, padding:12, borderWidth:0.5, borderColor:COLORS.border, alignItems:'center' },
  pidEmoji: { fontSize:20, marginBottom:4 },
  pidVal: { fontSize:20, fontWeight:'300', color:COLORS.accent },
  pidUnit: { fontSize:9, color:COLORS.muted },
  pidLabel: { fontSize:10, color:COLORS.muted, marginTop:2 },
  dtcCard: { backgroundColor:'#0d0a04', borderWidth:0.5, borderColor:'rgba(232,160,0,.4)', borderRadius:10, padding:14, marginBottom:8 },
  dtcCode: { fontSize:18, fontWeight:'700', color:COLORS.accent, fontFamily:'monospace', marginBottom:6 },
  dtcAnalyze: { alignSelf:'flex-start' },
});
