// app/(tabs)/dylan.tsx — Dylan IA Chat Screen
import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Keyboard,
} from 'react-native';
import { authedFetch } from '../../lib/supabase';
import { COLORS } from '../_layout';

type Message = { id: string; role: 'user' | 'dylan' | 'sys'; text: string; ts: number };

const CHIPS = [
  'Voyant moteur allumé',
  'Bruit au démarrage',
  'Perte de puissance',
  'CT Check 9,99€',
];

export default function DylanScreen() {
  const [messages, setMessages] = useState<Message[]>([{
    id: '0', role: 'dylan', ts: Date.now(),
    text: 'Bonjour ! Je suis Dylan, votre expert automobile IA.\n\nDécrivez votre panne, un code OBD, ou posez-moi une question sur votre véhicule.',
  }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<FlatList>(null);

  async function send(text?: string) {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput('');
    Keyboard.dismiss();

    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: msg, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const r = await authedFetch('dylan_agents', {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: msg }], context: {} }),
      });
      const data = await r.json();
      const reply = data?.text || data?.reply || data?.content?.[0]?.text || 'Je n\'ai pas pu analyser cette demande.';
      setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'dylan', text: reply, ts: Date.now() }]);
    } catch (e) {
      setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'sys', text: 'Erreur réseau. Vérifiez votre connexion.', ts: Date.now() }]);
    } finally {
      setLoading(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  function Bubble({ item }: { item: Message }) {
    const isDylan = item.role === 'dylan';
    const isSys = item.role === 'sys';
    return (
      <View style={[styles.msgRow, isDylan ? styles.msgLeft : styles.msgRight]}>
        {isDylan && (
          <View style={styles.avatar}><Text style={{ fontSize: 11, fontWeight: '700', color: '#000' }}>D</Text></View>
        )}
        <View style={[styles.bubble,
          isDylan ? styles.bubbleDylan : isSys ? styles.bubbleSys : styles.bubbleUser
        ]}>
          <Text style={[styles.bubbleText, isDylan ? { color: COLORS.text } : { color: isDylan ? COLORS.text : '#e0f0ff' }]}>
            {item.text}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Dylan IA</Text>
        <Text style={styles.headerSub}>Expert automobile</Text>
      </View>

      {/* Chat feed */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={i => i.id}
        renderItem={({ item }) => <Bubble item={item} />}
        contentContainerStyle={styles.feed}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />

      {/* Loading dots */}
      {loading && (
        <View style={[styles.msgRow, styles.msgLeft, { marginBottom: 4, paddingHorizontal: 16 }]}>
          <View style={styles.avatar}><Text style={{ fontSize: 11, fontWeight: '700', color: '#000' }}>D</Text></View>
          <View style={[styles.bubble, styles.bubbleDylan, { paddingVertical: 8 }]}>
            <ActivityIndicator size="small" color={COLORS.accent} />
          </View>
        </View>
      )}

      {/* Suggestion chips */}
      <View style={styles.chipsWrap}>
        {CHIPS.map(c => (
          <TouchableOpacity key={c} style={styles.chip} onPress={() => send(c)}>
            <Text style={styles.chipText}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Décrivez votre panne..."
          placeholderTextColor={COLORS.muted}
          multiline
          maxLength={1000}
          onSubmitEditing={() => send()}
        />
        <TouchableOpacity style={[styles.sendBtn, !input.trim() && { opacity: 0.4 }]} onPress={() => send()} disabled={!input.trim() || loading}>
          <Text style={{ fontSize: 18 }}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  headerTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text, letterSpacing: 0.3 },
  headerSub: { fontSize: 12, color: COLORS.muted, marginTop: 1 },
  feed: { padding: 16, paddingBottom: 8 },
  msgRow: { flexDirection: 'row', marginBottom: 10, alignItems: 'flex-end', gap: 8 },
  msgLeft: { justifyContent: 'flex-start' },
  msgRight: { justifyContent: 'flex-end' },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  bubble: { maxWidth: '80%', padding: 10, borderRadius: 12 },
  bubbleDylan: { backgroundColor: COLORS.card, borderWidth: 0.5, borderColor: COLORS.border, borderBottomLeftRadius: 4 },
  bubbleUser: { backgroundColor: '#1e3a5f', borderWidth: 0.5, borderColor: '#2a4a7f', borderBottomRightRadius: 4 },
  bubbleSys: { backgroundColor: '#1a0808', borderWidth: 0.5, borderColor: '#3d1515', borderRadius: 8 },
  bubbleText: { fontSize: 13, lineHeight: 19 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingVertical: 8 },
  chip: { backgroundColor: COLORS.card, borderWidth: 0.5, borderColor: COLORS.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  chipText: { fontSize: 11, color: COLORS.muted },
  inputRow: { flexDirection: 'row', padding: 12, paddingBottom: 24, gap: 8, borderTopWidth: 0.5, borderTopColor: COLORS.border, alignItems: 'flex-end' },
  input: { flex: 1, backgroundColor: COLORS.card, borderWidth: 0.5, borderColor: COLORS.border, borderRadius: 12, padding: 12, fontSize: 14, color: COLORS.text, maxHeight: 100 },
  sendBtn: { width: 44, height: 44, backgroundColor: COLORS.accent, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
