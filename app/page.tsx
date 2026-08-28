import Link from 'next/link';
import { ShieldCheck, Bot, Send, ArrowRight } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-2xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mx-auto">
          <Bot size={36} />
        </div>

        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            MouxBot Discord Join SaaS
          </h1>
          <p className="text-slate-400 text-sm mt-2 max-w-lg mx-auto">
            Multi-Tenant Member Join Notification Platform with Telegram License Activation & Institutional Audit Management
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 text-left">
          <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl">
            <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm mb-1">
              <ShieldCheck size={18} />
              <span>Admin Console</span>
            </div>
            <p className="text-xs text-slate-400">
              Manage multi-tenant customer accounts, issue 1-month activation keys, renew licenses, and configure notification channels.
            </p>
          </div>

          <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl">
            <div className="flex items-center gap-2 text-sky-400 font-semibold text-sm mb-1">
              <Send size={18} />
              <span>Telegram Bot Activation</span>
            </div>
            <p className="text-xs text-slate-400">
              Customers bind their Telegram account and activate their license via Telegram bot using their unique activation code.
            </p>
          </div>
        </div>

        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/admin"
            className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-6 py-2.5 rounded-lg text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
          >
            <span>Open Admin Dashboard</span>
            <ArrowRight size={16} />
          </Link>
        </div>

        <div className="pt-6 border-t border-slate-800/80 text-xs text-slate-500 font-mono">
          System Operational • Render & PostgreSQL Production Ready
        </div>
      </div>
    </div>
  );
}
