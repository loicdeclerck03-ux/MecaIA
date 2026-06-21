// app/(auth)/login.tsx — MecaIA Mobile — Login/Register
import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../_layout';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleAuth() {
    if (!email || !password) { Alert.alert('Erreur', 'Email et mot de passe requis'); return; }
    setLoading(true);
    try {
      if (isRegister) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        Alert.alert('Compte créé !', 'Vérifiez vos emails pour confirmer votre compte.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        {/* Logo */}
        <View style={styles.logoWrap}>
          <View style={styles.logoIcon}>
            <Text style={styles.logoIconText}>M</Text>
          </View>
          <Text style={styles.logoText}>MECA<Text style={{ color: COLORS.accent }}>IA</Text></Text>
        </View>
        <Text style={styles.tagline}>L'expert automobile IA dans votre poche</Text>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="votre@email.com"
            placeholderTextColor={COLORS.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.label}>Mot de passe</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={COLORS.muted}
            secureTextEntry
          />
          <TouchableOpacity style={styles.btn} onPress={handleAuth} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.btnText}>{isRegister ? 'Créer mon compte' : 'Se connecter'}</Text>
            }
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsRegister(!isRegister)} style={{ marginTop: 16 }}>
            <Text style={styles.toggle}>
              {isRegister ? 'Déjà un compte ? Se connecter' : 'Pas de compte ? Créer un compte'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.note}>Vos données sont chiffrées et restent privées.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  logoWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  logoIcon: { width: 38, height: 38, borderRadius: 8, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  logoIconText: { fontSize: 22, fontWeight: '900', color: '#000' },
  logoText: { fontSize: 28, fontWeight: '700', letterSpacing: 3, color: COLORS.text, fontFamily: 'System' },
  tagline: { fontSize: 13, color: COLORS.muted, marginBottom: 36, textAlign: 'center' },
  form: { width: '100%', maxWidth: 380 },
  label: { fontSize: 12, color: COLORS.muted, marginBottom: 6, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 13, fontSize: 15, color: COLORS.text, marginBottom: 14 },
  btn: { backgroundColor: COLORS.accent, borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 4 },
  btnText: { color: '#000', fontWeight: '700', fontSize: 15 },
  toggle: { color: COLORS.muted, textAlign: 'center', fontSize: 13 },
  note: { color: COLORS.muted, fontSize: 11, marginTop: 32, textAlign: 'center' },
});
