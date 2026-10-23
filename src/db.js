import { createClient } from '@supabase/supabase-js';

const url = __SUPABASE_URL__;
const anonKey = __SUPABASE_ANON_KEY__;

export const isConfigured = Boolean(url && anonKey);
export const supabase = isConfigured ? createClient(url, anonKey) : null;

let activeWorkspaceId = null;

const workspaceColumns = {
  company_settings: 'opening_balance, opening_balance_date',
  cashflow_transactions: 'id, transaction_date, category, requester, description, amount, kind, supplier_bill_id',
  supplier_ledger_entries: 'id, supplier, entry_date, entry_type, amount, description, linked_bill_id, cashflow_transaction_id, created_at',
  supplier_debt_adjustments: 'id, supplier, entry_date, amount, description, created_at',
  sales_invoices: 'id, invoice_date, due_date, paid_date, customer, invoice_number, po_number, amount, paid_amount, outstanding_amount',
  supplier_purchase_orders: 'id, po_number, supplier, customer, order_date, items',
  customer_orders: 'id, order_date, due_date, po_number, customer, spm_skg, item, size, qty_order, qty_produced, qty_delivered, unit_price, amount, po_tax_amount, total_price, size_sheet, floot, score, height, score_secondary',
  production_events: 'id, customer_order_id, event_date, cause_category, cause_detail, affected_qty, status',
};
const workspaceOrderColumns = {
  company_settings: 'owner_id',
  cashflow_transactions: 'id',
  supplier_ledger_entries: 'id',
  supplier_debt_adjustments: 'id',
  sales_invoices: 'id',
  supplier_purchase_orders: 'id',
  customer_orders: 'id',
  production_events: 'id',
};
const workspacePageSize = 500;

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

export async function loadWorkspace(tables = Object.keys(workspaceColumns)) {
  const requestedTables = [...new Set(tables)].filter((table) => workspaceColumns[table]);
  if (!requestedTables.length) return {};
  const results = await Promise.all(requestedTables.map(async (table) => {
    const rows = [];
    for (let offset = 0; ; offset += workspacePageSize) {
      const { data, error } = await supabase.from(table)
        .select(workspaceColumns[table])
        .order(workspaceOrderColumns[table], { ascending: true })
        .range(offset, offset + workspacePageSize - 1);
      if (error) throw error;
      const page = data || [];
      rows.push(...page);
      if (page.length < workspacePageSize) return [table, rows];
    }
  }));
  return Object.fromEntries(results);
}

export async function loadInputLogs(month) {
  let query = supabase
    .from('input_logs')
    .select('id, actor_email, table_name, record_id, action, changes, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (month) {
    const [year, monthNumber] = month.split('-').map(Number);
    query = query
      .gte('created_at', new Date(Date.UTC(year, monthNumber - 1, 1)).toISOString())
      .lt('created_at', new Date(Date.UTC(year, monthNumber, 1)).toISOString());
  }
  const { data, error } = await query;
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

