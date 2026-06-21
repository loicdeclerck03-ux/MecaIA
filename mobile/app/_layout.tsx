// app/_layout.tsx — MecaIA Mobile — Root layout
import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';

SplashScreen.preventAutoHideAsync();

const COLORS = {
  bg: '#060809',
  accent: '#e8a000',
  text: '#eef4fa',
  muted: '#6b7a89',
  card: '#0a1018',
  border: '#1a2430',
};

export { COLORS };

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)/dylan');
    }
    SplashScreen.hideAsync();
  }, [session, loading, segments]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: COLORS.bg },
          animation: 'fade',
        }}
      />
    </View>
  );
}
