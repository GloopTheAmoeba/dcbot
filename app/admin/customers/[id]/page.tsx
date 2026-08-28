'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ShieldCheck,
  RefreshCw,
  Ban,
  Play,
  XCircle,
  Copy,
  Check,
  Disc as DiscordIcon,
  Send as TelegramIcon,
  Save,
  Clock,
  User,
} from 'lucide-react';

import { useAdminSession } from '@/components/AdminSessionProvider';

interface Guild {
  id: string;
  guild_id: string;
  guild_name: string;
  notification_channel_id: string | null;
  enabled: boolean;
  joined_at: string;
}

interface LicenseEvent {
  id: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface CustomerDetail {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
  activation_code: string;
  status: string;
  telegram_user_id: number | null;
  activated_at: string | null;
  expires_at: string | null;
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { adminFetch } = useAdminSession();
  const resolvedParams = use(params);
  const customerId = resolvedParams.id;

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [events, setEvents] = useState<LicenseEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState(false);
  const [channelInputs, setChannelInputs] = useState<Record<string, string>>({});
  const [savingGuild, setSavingGuild] = useState<string | null>(null);
  const router = useRouter();

  const fetchCustomerDetail = useCallback(async () => {
    try {
      const res = await adminFetch(`/api/admin/customers/${customerId}`);
      if (!res.ok) return;

      const data = await res.json();
      setCustomer(data.customer);
      setGuilds(data.guilds || []);
      setEvents(data.events || []);

      const channelMap: Record<string, string> = {};
      (data.guilds || []).forEach((g: Guild) => {
        channelMap[g.guild_id] = g.notification_channel_id || '';
      });
      setChannelInputs(channelMap);
    } catch {
      // error fetching
    } finally {
      setLoading(false);
    }
  }, [adminFetch, customerId]);

  useEffect(() => {
    let ignore = false;
    adminFetch(`/api/admin/customers/${customerId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!ignore && data) {
          setCustomer(data.customer);
          setGuilds(data.guilds || []);
          setEvents(data.events || []);

          const channelMap: Record<string, string> = {};
          (data.guilds || []).forEach((g: Guild) => {
            channelMap[g.guild_id] = g.notification_channel_id || '';
          });
          setChannelInputs(channelMap);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [adminFetch, customerId]);

  const handleRenew = async () => {
    try {
      const res = await adminFetch(`/api/admin/customers/${customerId}/renew`, {
        method: 'POST',
      });
      if (res.ok) fetchCustomerDetail();
    } catch {
      // error
    }
  };

  const handleUpdateStatus = async (status: string) => {
    try {
      const res = await adminFetch(`/api/admin/customers/${customerId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) fetchCustomerDetail();
    } catch {
      // error
    }
  };

  const handleSaveGuildConfig = async (guildId: string, enabled: boolean) => {
    setSavingGuild(guildId);
    try {
      const channelId = channelInputs[guildId] || '';
      const res = await adminFetch(`/api/admin/customers/${customerId}/guilds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId, channelId, enabled }),
      });
      if (res.ok) fetchCustomerDetail();
    } catch {
      // error
    } finally {
      setSavingGuild(null);
    }
  };

  const copyCode = () => {
    if (!customer?.activation_code) return;
    navigator.clipboard.writeText(customer.activation_code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <p className="text-slate-400">Loading tenant details...</p>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
        <Link href="/admin" className="text-indigo-400 flex items-center gap-2 mb-4">
          <ArrowLeft size={16} /> Back to Customers
        </Link>
        <p className="text-red-400">Customer tenant not found.</p>
      </div>
    );
  }

  const isExpired = customer.expires_at && new Date(customer.expires_at) <= new Date();
  const displayStatus = isExpired && customer.status === 'ACTIVE' ? 'EXPIRED' : customer.status;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Bar */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/admin"
              className="p-2 text-slate-400 hover:text-white bg-slate-950 rounded-lg border border-slate-800 transition"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-base font-bold text-white">{customer.name}</h1>
              <p className="text-xs text-slate-400 font-mono">ID: {customer.id}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRenew}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <RefreshCw size={14} />
              <span>Renew +1 Month</span>
            </button>

            {customer.status === 'SUSPENDED' ? (
              <button
                onClick={() => handleUpdateStatus('ACTIVE')}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <Play size={14} />
                <span>Reactivate</span>
              </button>
            ) : customer.status === 'ACTIVE' ? (
              <button
                onClick={() => handleUpdateStatus('SUSPENDED')}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <Ban size={14} />
                <span>Suspend</span>
              </button>
            ) : null}

            {customer.status !== 'REVOKED' && (
              <button
                onClick={() => handleUpdateStatus('REVOKED')}
                className="px-3 py-1.5 bg-red-600/80 hover:bg-red-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <XCircle size={14} />
                <span>Revoke License</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Info Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* License Overview Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                License Details
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  displayStatus === 'ACTIVE'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : displayStatus === 'PENDING'
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                }`}
              >
                {displayStatus}
              </span>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-slate-500 block">Activation Code</label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="bg-slate-950 px-3 py-1.5 rounded text-indigo-300 font-mono text-base border border-slate-800 font-bold">
                    {customer.activation_code}
                  </code>
                  <button
                    onClick={copyCode}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition"
                  >
                    {copiedCode ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-500 block">Activated At (UTC)</label>
                <p className="text-slate-200 font-mono text-xs mt-0.5">
                  {customer.activated_at ? new Date(customer.activated_at).toUTCString() : 'Not Yet Activated'}
                </p>
              </div>

              <div>
                <label className="text-xs text-slate-500 block">Expires At (UTC)</label>
                <p className="text-slate-200 font-mono text-xs mt-0.5">
                  {customer.expires_at ? new Date(customer.expires_at).toUTCString() : 'N/A'}
                </p>
              </div>
            </div>
          </div>

          {/* Telegram Account Linkage */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <TelegramIcon size={16} className="text-sky-400" />
                Telegram Activation
              </span>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-slate-500 block">Bound Telegram User ID</label>
                <p className="text-slate-200 font-mono text-base font-semibold mt-1">
                  {customer.telegram_user_id ? `@${customer.telegram_user_id}` : 'Unbound'}
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/80 text-xs text-slate-400">
                <p>
                  To activate, the customer sends{' '}
                  <code className="text-indigo-300 font-mono">/activate {customer.activation_code}</code> to the
                  Telegram activation bot.
                </p>
              </div>
            </div>
          </div>

          {/* Tenant Notes */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <User size={16} className="text-indigo-400" />
                Tenant Metadata
              </span>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-slate-500 block">Created At</label>
                <p className="text-slate-200 font-mono text-xs mt-0.5">
                  {new Date(customer.created_at).toUTCString()}
                </p>
              </div>

              <div>
                <label className="text-xs text-slate-500 block">Internal Notes</label>
                <p className="text-slate-300 text-xs mt-1 bg-slate-950 p-3 rounded-lg border border-slate-800 min-h-[60px]">
                  {customer.notes || 'No internal notes provided.'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Discord Guild Configurations */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2">
              <DiscordIcon size={20} className="text-indigo-400" />
              <h2 className="text-base font-bold text-white">Configured Discord Guilds</h2>
            </div>
            <span className="text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2.5 py-0.5 rounded-full font-mono">
              {guilds.length} Installed Guilds
            </span>
          </div>

          {guilds.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">
              No Discord guilds registered for this tenant yet. The bot will automatically register when invited to a guild.
            </p>
          ) : (
            <div className="space-y-4">
              {guilds.map((g) => (
                <div
                  key={g.id}
                  className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <p className="font-bold text-white text-sm">{g.guild_name}</p>
                    <p className="text-xs font-mono text-slate-400">Guild ID: {g.guild_id}</p>
                  </div>

                  <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className="flex-1 md:w-64">
                      <label className="text-[10px] uppercase font-semibold text-slate-500 block mb-1">
                        Notification Channel ID
                      </label>
                      <input
                        type="text"
                        value={channelInputs[g.guild_id] || ''}
                        onChange={(e) =>
                          setChannelInputs({ ...channelInputs, [g.guild_id]: e.target.value })
                        }
                        placeholder="e.g. 123456789012345678"
                        className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <button
                      onClick={() => handleSaveGuildConfig(g.guild_id, g.enabled)}
                      disabled={savingGuild === g.guild_id}
                      className="mt-4 md:mt-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium flex items-center gap-1 transition"
                    >
                      <Save size={14} />
                      <span>{savingGuild === g.guild_id ? 'Saving...' : 'Save'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Audit & Event Log */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Clock size={18} className="text-slate-400" />
            <h2 className="text-base font-bold text-white">License Audit Timeline</h2>
          </div>

          <div className="space-y-2">
            {events.length === 0 ? (
              <p className="text-xs text-slate-500">No events recorded for this customer.</p>
            ) : (
              events.map((e) => (
                <div
                  key={e.id}
                  className="bg-slate-950 p-3 rounded-lg border border-slate-800/60 flex items-center justify-between text-xs font-mono"
                >
                  <span className="font-semibold text-indigo-400">{e.event_type}</span>
                  <span className="text-slate-500">{new Date(e.created_at).toUTCString()}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
