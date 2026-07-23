import {
  Bot,
  LayoutDashboard,
  ListChecks,
  Settings as SettingsIcon,
  Sparkles,
  Target,
  Upload,
  Wallet
} from 'lucide-react';

import { Badge } from '@ledgerpilot/ui';

import { useWorkspace, type ViewKey } from '../context/WorkspaceContext';

type NavEntry = {
  key: ViewKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
};

const providerLabel: Record<string, string> = {
  'local-rules': 'Local rules',
  ollama: 'Ollama',
  'openai-compatible': 'OpenAI'
};

export const Sidebar = () => {
  const { activeView, setActiveView, dashboardData, reviewTransactions, settings } = useWorkspace();

  const mainNav: NavEntry[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'transactions', label: 'Transactions', icon: Wallet },
    { key: 'categorize', label: 'Categorize', icon: ListChecks, badge: reviewTransactions.length },
    { key: 'goals', label: 'Goals', icon: Target },
    { key: 'advisor', label: 'Advisor', icon: Bot }
  ];

  const manageNav: NavEntry[] = [{ key: 'import', label: 'Import data', icon: Upload }];

  const renderItem = (item: NavEntry) => {
    const Icon = item.icon;
    const isActive = activeView === item.key;
    return (
      <button
        key={item.key}
        onClick={() => setActiveView(item.key)}
        className={[
          'group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
          isActive ? 'bg-white/[0.06] text-white' : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200'
        ].join(' ')}
      >
        {isActive ? (
          <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-gradient" />
        ) : null}
        <Icon className={`h-[18px] w-[18px] shrink-0 transition-colors ${isActive ? 'text-sky-300' : 'text-slate-500 group-hover:text-slate-300'}`} />
        <span className="flex-1 text-left">{item.label}</span>
        {item.badge ? (
          <Badge tone={isActive ? 'brand' : 'neutral'} className="px-1.5 py-0 text-[10px]">
            {item.badge}
          </Badge>
        ) : null}
      </button>
    );
  };

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-white/5 bg-slate-950/60 px-3 py-5">
      <div className="flex items-center gap-2.5 px-2 pb-6">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
          <Sparkles className="h-[18px] w-[18px] text-white" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-white">LedgerPilot</p>
          <p className="truncate text-[11px] text-slate-500">Local AI finance copilot</p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto">
        <div className="space-y-1">
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-600">Workspace</p>
          {mainNav.map(renderItem)}
        </div>
        <div className="space-y-1">
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-600">Manage</p>
          {manageNav.map(renderItem)}
        </div>
      </nav>

      <div className="space-y-1 border-t border-white/5 pt-3">
        {renderItem({ key: 'settings', label: 'Settings', icon: SettingsIcon })}
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] text-slate-500">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-emerald-400" />
          </span>
          AI: {providerLabel[settings.aiProvider] ?? settings.aiProvider}
        </div>
        <p className="px-3 text-[10px] text-slate-700">
          {dashboardData.generatedAt ? `Synced ${new Date(dashboardData.generatedAt).toLocaleTimeString()}` : 'Not synced yet'}
        </p>
      </div>
    </aside>
  );
};
