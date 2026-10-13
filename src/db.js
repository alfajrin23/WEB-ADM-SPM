import { createClient } from '@supabase/supabase-js';

const url = __SUPABASE_URL__;
const anonKey = __SUPABASE_ANON_KEY__;

export const isConfigured = Boolean(url && anonKey);
export const supabase = isConfigured ? createClient(url, anonKey) : null;

let activeWorkspaceId = null;

export function setWorkspaceId(workspaceId) {
  activeWorkspaceId = workspaceId || null;
}

export async function loadProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, role, workspace_id')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function loadWorkspace() {
  const tables = [
    'company_settings', 'cashflow_transactions', 'supplier_ledger_entries',
    'sales_invoices', 'supplier_purchase_orders', 'customer_orders', 'production_events',
  ];
  const results = await Promise.all(tables.map((table) => supabase.from(table).select('*')));
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
  return Object.fromEntries(tables.map((table, index) => [table, results[index].data || []]));
}

export async function loadInputLogs() {
  const { data, error } = await supabase
    .from('input_logs')
    .select('id, actor_email, table_name, record_id, action, changes, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return data || [];
}

export async function loadWorkspaceUsers() {
  const { data, error } = await supabase.rpc('list_workspace_users');
  if (error) throw error;
  return data || [];
}

export async function setWorkspaceUserRole(userId, role) {
  const { error } = await supabase.rpc('set_workspace_user_role', {
    target_user_id: userId,
    new_role: role,
  });
  if (error) throw error;
}

export async function saveRow(table, values, id) {
  const workspaceValues = { ...values, workspace_id: activeWorkspaceId };
  const query = id
    ? supabase.from(table).update(workspaceValues).eq('id', id).select().single()
    : supabase.from(table).insert(workspaceValues).select().single();
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function deleteRow(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

export async function upsertRows(table, rows, conflict) {
  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows.slice(index, index + 100).map((row) => ({ ...row, workspace_id: activeWorkspaceId }));
    const { error } = await supabase.from(table).upsert(batch, {
      onConflict: conflict,
    });
    if (error) throw error;
  }
}

