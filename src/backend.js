import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

export async function loadStudentData(userId) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('student_planner_data').select('payload,updated_at').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data?.payload || null;
}

export async function saveStudentData(userId, payload) {
  if (!supabase) return;
  const { error } = await supabase.from('student_planner_data').upsert({ user_id: userId, payload, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}
