// lib/supabase.ts — MecaIA Mobile
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import 'react-native-url-polyfill/auto';

const SUPABASE_URL = Constants.expoConfig?.extra?.supabaseUrl || 'https://vexxjbpbfrvgszvzpmgu.supabase.co';
const SUPABASE_ANON = Constants.expoConfig?.extra?.supabaseAnonKey || '';
const API_BASE = Constants.expoConfig?.extra?.apiBaseUrl || 'https://mecaiaauto.com/.netlify/functions';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const apiUrl = (fn: string) => `${API_BASE}/${fn}`;

export async function authedFetch(fn: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return fetch(apiUrl(fn), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}
