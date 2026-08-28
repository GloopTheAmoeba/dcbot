'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Activity, ShieldCheck, RefreshCw, Search } from 'lucide-react';

import { useAdminSession } from '@/components/AdminSessionProvider';

interface BotEvent {
  id: string;
  guild_id: string;
  event_type: string;
  user_id: string | null;
  channel_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export default function AdminLogsPage() {
  const { adminFetch } = useAdminSession();
  const [logs, setLogs] = useState<BotEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterGuild, setFilterGuild] = useState('');
  const router = useRouter();

  const fetchLogs = useCallback(async () => {
    try {
      const url = filterGuild ? `/api/admin/logs?guildId=${filterGuild}` : '/api/admin/logs';
      const res = await adminFetch(url);
      if (!res.ok) return;

      const data = await res.json();
      setLogs(data.events || data.logs || []);
    } catch {
      // error fetching logs
    } finally {
      setLoading(false);
    }
  }, [adminFetch, filterGuild]);

  useEffect(() => {
    let ignore = false;
    const url = filterGuild ? `/api/admin/logs?guildId=${filterGuild}` : '/api/admin/logs';
    adminFetch(url)
      .then((res) => (res.ok ? res.json() : { events: [] }))
      .then((data) => {
        if (!ignore) {
          setLogs(data.events || data.logs || []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [adminFetch, filterGuild]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="p-2 text-slate-400 hover:text-white bg-slate-950 rounded-lg border border-slate-800 transition"
            >
              <ArrowLeft size={18} />
            </Link>
            <div className="flex items-center gap-2">
              <Activity size={20} className="text-indigo-400" />
              <h1 className="font-bold text-white tracking-tight">Discord Bot Event Logs</h1>
            </div>
          </div>

          <button
            onClick={fetchLogs}
            className="p-2 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition flex items-center gap-1.5 text-xs font-semibold"
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Filter Bar */}
        <div className="flex items-center gap-4">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              type="text"
              value={filterGuild}
              onChange={(e) => setFilterGuild(e.target.value)}
              placeholder="Filter by Guild ID..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition font-mono"
            />
          </div>
        </div>

        {/* Logs Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm font-mono">
              <thead className="bg-slate-950/60 border-b border-slate-800 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-6 py-3.5">Timestamp (UTC)</th>
                  <th className="px-6 py-3.5">Event Type</th>
                  <th className="px-6 py-3.5">Guild ID</th>
                  <th className="px-6 py-3.5">Target User ID</th>
                  <th className="px-6 py-3.5">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                      Loading audit logs...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-500 font-sans">
                      No bot events recorded matching criteria.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/40 transition">
                      <td className="px-6 py-3.5 text-slate-400">
                        {new Date(log.created_at).toUTCString()}
                      </td>

                      <td className="px-6 py-3.5 font-bold">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] ${
                            log.event_type.includes('JOIN')
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : log.event_type.includes('DUPLICATE')
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : log.event_type.includes('ERROR') || log.event_type.includes('FAILED')
                              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                              : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                          }`}
                        >
                          {log.event_type}
                        </span>
                      </td>

                      <td className="px-6 py-3.5 text-slate-300">{log.guild_id}</td>

                      <td className="px-6 py-3.5 text-slate-300">{log.user_id || 'N/A'}</td>

                      <td className="px-6 py-3.5 text-slate-400 max-w-xs truncate">
                        {JSON.stringify(log.details)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
