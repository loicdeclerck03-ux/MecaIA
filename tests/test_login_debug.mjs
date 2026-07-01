import { createClient } from '@supabase/supabase-js';
const sb = createClient(
  'https://vexxjbpbfrvgszvzpmgu.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZleHhqYnBiZnJ2Z3N6dnpwbWd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NzU4NzksImV4cCI6MjA5NTU1MTg3OX0.T2owu6atANKHH7PfEUL-BG8F6MAizhsqZb3RQWJOR1U'
);
try {
  const { data, error } = await sb.auth.signInWithPassword({
    email: 'agent.marie@mecaia-beta.io',
    password: 'MecaIA-Beta-2026!M'
  });
  console.log('Error:', JSON.stringify(error));
  console.log('Error status:', error?.status);
  console.log('Error code:', error?.code);
  console.log('Session OK:', !!data?.session);
  if (data?.session) console.log('OK - Login reussi');
  else console.log('FAIL - no session:', error?.message);
} catch(e) {
  console.log('EXCEPTION:', e.message);
}
