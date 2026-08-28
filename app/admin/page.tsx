'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Users,
  Search,
  Plus,
  Copy,
  Check,
  RefreshCw,
  Ban,
  Play,
  XCircle,
  Activity,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';

import { useAdminSession } from '@/components/AdminSessionProvider';

interface Customer {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
  activation_code: string;
  status: string;
  telegram_user_id: number | null;
  activated_at: string | null;
  expires_at: string | null;
  guild_count: number;
}

export default function AdminDashboardPage() {
  const { adminFetch } = useAdminSession();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerNotes, setNewCustomerNotes] = useState('');
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [createdCustomer, setCreatedCustomer] = useState<Customer | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const fetchCustomers = useCallback(async () => {
    try {
      const url = search ? `/api/admin/customers?q=${encodeURIComponent(search)}` : '/api/admin/customers';
      const res = await adminFetch(url);
      if (!res.ok) {
        setCustomers([]);
        return;
      }
      const data = await res.json();
      setCustomers(data.customers || []);
    } catch {
      // error fetching
    } finally {
      setLoading(false);
    }
  }, [adminFetch, search]);

  useEffect(() => {
    let ignore = false;
    const url = search ? `/api/admin/customers?q=${encodeURIComponent(search)}` : '/api/admin/customers';
    adminFetch(url)
      .then((res) => (res.ok ? res.json() : { customers: [] }))
      .then((data) => {
        if (!ignore) {
          setCustomers(data.customers || []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [adminFetch, search]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedName = newCustomerName.trim();
    if (!trimmedName) {
      setErrorMessage('Please enter a customer or business name.');
      return;
    }

    setSubmitting(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await adminFetch('/api/admin/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, notes: newCustomerNotes.trim() || null }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await res.json().catch(() => ({ error: 'Invalid response from server' }));

      if (res.ok && data.activationCode) {
        setCreatedCode(data.activationCode);
        setCreatedCustomer(data.customer || null);
        setNewCustomerName('');
        setNewCustomerNotes('');
        await fetchCustomers();
      } else {
        setErrorMessage(data.error || 'Could not create license. Please check the database connection and try again.');
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        setErrorMessage('Request timed out. Please check database connection and try again.');
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred while generating license.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRenew = async (customerId: string) => {
    try {
      const res = await adminFetch(`/api/admin/customers/${customerId}/renew`, {
        method: 'POST',
      });
      if (res.ok) {
        fetchCustomers();
      }
    } catch {
      // error renewing
    }
  };

  const handleUpdateStatus = async (customerId: string, status: string) => {
    try {
      const res = await adminFetch(`/api/admin/customers/${customerId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        fetchCustomers();
      }
    } catch {
      // error updating status
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const activeCount = customers.filter(
    (c) => c.status === 'ACTIVE' && c.expires_at && new Date(c.expires_at) > new Date()
  ).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <ShieldCheck size={20} />
            </div>
            <div>
              <span className="font-bold text-slate-100 tracking-tight">MouxBot SaaS Admin</span>
              <span className="ml-2 text-xs px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
                Multi-Tenant Console
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <nav className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <Link
                href="/admin"
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white shadow-sm flex items-center gap-1.5"
              >
                <Users size={14} />
                <span>Customers</span>
              </Link>
              <Link
                href="/admin/logs"
                className="px-3 py-1.5 text-xs font-medium rounded-md text-slate-400 hover:text-slate-200 transition flex items-center gap-1.5"
              >
                <Activity size={14} />
                <span>Bot Logs</span>
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* KPI Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Total Tenants</p>
            <p className="text-3xl font-bold text-white mt-2">{customers.length}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-400">Active Licenses</p>
            <p className="text-3xl font-bold text-emerald-400 mt-2">{activeCount}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
            <p className="text-xs font-medium uppercase tracking-wider text-amber-400">Pending Activation</p>
            <p className="text-3xl font-bold text-amber-400 mt-2">
              {customers.filter((c) => c.status === 'PENDING' || c.status === 'UNACTIVATED').length}
            </p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
            <p className="text-xs font-medium uppercase tracking-wider text-indigo-400">Total Discord Guilds</p>
            <p className="text-3xl font-bold text-indigo-400 mt-2">
              {customers.reduce((acc, c) => acc + (c.guild_count || 0), 0)}
            </p>
          </div>
        </div>

        {/* Action Controls Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, code, or notes..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          <button
            onClick={() => {
              setCreatedCode(null);
              setShowCreateModal(true);
            }}
            className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
          >
            <Plus size={16} />
            <span>New Customer</span>
          </button>
        </div>

        {/* Customer Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-950/60 border-b border-slate-800 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-6 py-3.5">Customer</th>
                  <th className="px-6 py-3.5">Activation Code</th>
                  <th className="px-6 py-3.5">Telegram ID</th>
                  <th className="px-6 py-3.5">License Status</th>
                  <th className="px-6 py-3.5">Expiration (UTC)</th>
                  <th className="px-6 py-3.5">Guilds</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                      Loading customer tenant records...
                    </td>
                  </tr>
                ) : customers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                      No customers found. Click &quot;New Customer&quot; to provision a license.
                    </td>
                  </tr>
                ) : (
                  customers.map((c) => {
                    const isExpired = c.expires_at && new Date(c.expires_at) <= new Date();
                    const displayStatus = isExpired && c.status === 'ACTIVE' ? 'EXPIRED' : c.status;

                    return (
                      <tr key={c.id} className="hover:bg-slate-800/40 transition">
                        <td className="px-6 py-4">
                          <div className="font-semibold text-slate-100">{c.name}</div>
                          {c.notes && <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{c.notes}</div>}
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <code className="font-mono text-indigo-300 font-semibold bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-800/50">
                              {c.activation_code}
                            </code>
                            <button
                              onClick={() => copyToClipboard(c.activation_code)}
                              className="p-1 text-slate-400 hover:text-white rounded transition"
                              title="Copy Code"
                            >
                              {copiedCode === c.activation_code ? (
                                <Check size={14} className="text-emerald-400" />
                              ) : (
                                <Copy size={14} />
                              )}
                            </button>
                          </div>
                        </td>

                        <td className="px-6 py-4 font-mono text-xs">
                          {c.telegram_user_id ? (
                            <span className="text-emerald-400 font-medium">@{c.telegram_user_id}</span>
                          ) : (
                            <span className="text-slate-500">Unbound</span>
                          )}
                        </td>

                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                              displayStatus === 'ACTIVE'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : displayStatus === 'PENDING' || displayStatus === 'UNACTIVATED'
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : displayStatus === 'SUSPENDED'
                                ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                : displayStatus === 'EXPIRED'
                                ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                                : 'bg-slate-800 text-slate-400 border border-slate-700'
                            }`}
                          >
                            {displayStatus}
                          </span>
                        </td>

                        <td className="px-6 py-4 text-xs font-mono text-slate-300">
                          {c.expires_at ? new Date(c.expires_at).toISOString().split('T')[0] : 'N/A'}
                        </td>

                        <td className="px-6 py-4 text-xs font-medium text-slate-300">
                          {c.guild_count || 0} Guilds
                        </td>

                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleRenew(c.id)}
                              className="px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-indigo-600/80 text-slate-200 hover:text-white rounded transition flex items-center gap-1"
                              title="Renew 1 Month"
                            >
                              <RefreshCw size={12} />
                              <span>+1Mo</span>
                            </button>

                            {c.status === 'SUSPENDED' ? (
                              <button
                                onClick={() => handleUpdateStatus(c.id, 'ACTIVE')}
                                className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded transition"
                                title="Reactivate"
                              >
                                <Play size={14} />
                              </button>
                            ) : c.status === 'ACTIVE' ? (
                              <button
                                onClick={() => handleUpdateStatus(c.id, 'SUSPENDED')}
                                className="p-1.5 text-amber-400 hover:bg-amber-500/10 rounded transition"
                                title="Suspend"
                              >
                                <Ban size={14} />
                              </button>
                            ) : null}

                            <Link
                              href={`/admin/customers/${c.id}`}
                              className="p-1.5 text-indigo-400 hover:bg-indigo-500/10 rounded transition"
                              title="View Details"
                            >
                              <ExternalLink size={14} />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Create Customer Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h2 className="text-lg font-bold text-white">Create New Customer License</h2>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setErrorMessage(null);
                }}
                className="text-slate-400 hover:text-white p-1"
              >
                <XCircle size={20} />
              </button>
            </div>

            {createdCode ? (
              <div className="space-y-5 py-2">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center space-y-2">
                  <div className="w-10 h-10 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto">
                    <Check size={20} />
                  </div>
                  <h3 className="text-base font-bold text-white">Customer Created Successfully</h3>
                  <p className="text-xs text-slate-300">
                    The customer and license record have been created in the database.
                  </p>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3.5 text-xs">
                  <div className="flex items-center justify-between py-1 border-b border-slate-800/80">
                    <span className="text-slate-400 font-medium">Customer:</span>
                    <span className="text-slate-100 font-semibold">{createdCustomer?.name || 'Customer'}</span>
                  </div>

                  <div className="py-1 border-b border-slate-800/80 space-y-1.5">
                    <span className="text-slate-400 font-medium block">Activation Code:</span>
                    <div className="flex items-center justify-between bg-slate-900 p-2.5 rounded-lg border border-indigo-500/30">
                      <code className="text-lg font-mono font-bold text-indigo-400 tracking-wider">
                        {createdCode}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(createdCode)}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
                      >
                        {copiedCode === createdCode ? (
                          <>
                            <Check size={14} className="text-emerald-300" />
                            <span>Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy size={14} />
                            <span>Copy Code</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b border-slate-800/80">
                    <span className="text-slate-400 font-medium">Status:</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      {createdCustomer?.status || 'UNACTIVATED'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b border-slate-800/80">
                    <span className="text-slate-400 font-medium">Telegram:</span>
                    <span className="text-slate-400 italic">Not connected</span>
                  </div>

                  <div className="flex items-center justify-between py-1">
                    <span className="text-slate-400 font-medium">License:</span>
                    <span className="text-slate-400 italic">Not activated (Pending Telegram pairing)</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreatedCode(null);
                    setCreatedCustomer(null);
                    setErrorMessage(null);
                  }}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-lg text-sm font-medium transition"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateCustomer} className="space-y-4">
                {errorMessage && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-3.5 py-2.5 rounded-lg text-xs flex items-center justify-between">
                    <span>{errorMessage}</span>
                    <button
                      type="button"
                      onClick={() => setErrorMessage(null)}
                      className="text-red-400 hover:text-white ml-2 p-0.5"
                    >
                      <XCircle size={14} />
                    </button>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Customer / Business Name
                  </label>
                  <input
                    type="text"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    required
                    placeholder="e.g. Crypto Trading Guild"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Notes / Reference (Optional)
                  </label>
                  <textarea
                    value={newCustomerNotes}
                    onChange={(e) => setNewCustomerNotes(e.target.value)}
                    placeholder="e.g. Paid via USDT manual transfer, 1 month starter plan"
                    rows={3}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition resize-none"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      setErrorMessage(null);
                    }}
                    className="px-4 py-2 text-sm text-slate-400 hover:text-white transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Provisioning...' : 'Generate License'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
