import { createClient } from '@supabase/supabase-js';

const url = __SUPABASE_URL__;
const anonKey = __SUPABASE_ANON_KEY__;

export const isConfigured = Boolean(url && anonKey);
export const supabase = isConfigured ? createClient(url, anonKey) : null;

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

export async function saveRow(table, values, id) {
  const query = id
    ? supabase.from(table).update(values).eq('id', id).select().single()
    : supabase.from(table).insert(values).select().single();
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
    const { error } = await supabase.from(table).upsert(rows.slice(index, index + 100), {
      onConflict: conflict,
    });
    if (error) throw error;
  }
}

