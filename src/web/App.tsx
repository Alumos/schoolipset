import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  CloudUpload,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorCheck,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Signal,
  UserRound,
  UsersRound,
  X,
  Zap,
} from 'lucide-react';
import { api, type EventItem, type ImportPreview, type Overview, type Teacher, openAdminStream } from './api';
import { Badge, type BadgeProps } from './components/ui/badge';
import { Button } from './components/ui/button';
import { formatFullTime, formatTime } from './lib/utils';

type Page = 'overview' | 'teachers' | 'events';

const statusMeta: Record<string, { label: string; variant: BadgeProps['variant']; dot: string }> = {
  compliant: { label: '合规', variant: 'success', dot: 'bg-emerald-500' },
  non_compliant: { label: 'IP 不一致', variant: 'danger', dot: 'bg-rose-500' },
  non_compliant_refused: { label: '已拒绝修改', variant: 'danger', dot: 'bg-rose-500' },
  modifying: { label: '修改中', variant: 'warning', dot: 'bg-amber-500' },
  change_failed: { label: '修改失败', variant: 'danger', dot: 'bg-rose-500' },
  change_failed_suspected_conflict: { label: '疑似 IP 冲突', variant: 'danger', dot: 'bg-rose-500' },
  rollback_failed: { label: '回滚失败', variant: 'danger', dot: 'bg-rose-500' },
  offline: { label: '离线', variant: 'muted', dot: 'bg-slate-400' },
  unknown: { label: '待连接', variant: 'muted', dot: 'bg-slate-400' },
  disabled: { label: '已停用', variant: 'muted', dot: 'bg-slate-300' },
};

const eventLabel = (result: string): string => statusMeta[result]?.label ?? result;

const formatMac = (value: string | null | undefined): string => {
  const compact = (value ?? '').replace(/[.:-]/g, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(compact) ? compact.match(/.{2}/g)!.join(':') : '—';
};

const StatusPill = ({ status }: { status: string }): React.JSX.Element => {
  const meta = statusMeta[status] ?? statusMeta.unknown;
  return (
    <Badge variant={meta.variant}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </Badge>
  );
};

const EmptyState = ({ icon: Icon, title, description }: { icon: typeof UsersRound; title: string; description: string }): React.JSX.Element => (
  <div className="flex min-h-[240px] flex-col items-center justify-center px-6 text-center">
    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
      <Icon size={24} strokeWidth={1.7} />
    </div>
    <p className="font-semibold text-ink">{title}</p>
    <p className="mt-1 max-w-sm text-sm leading-6 text-slate-400">{description}</p>
  </div>
);

const LoginScreen = ({ onLogin }: { onLogin: () => void }): React.JSX.Element => {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!password) return setError('请输入管理员密码');
    setLoading(true);
    setError('');
    try {
      await api.login(password);
      onLogin();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="login-shell">
      <div className="login-orb login-orb-one" />
      <div className="login-orb login-orb-two" />
      <section className="relative z-10 w-full max-w-[430px] rounded-[30px] border border-white/70 bg-white/85 p-8 shadow-soft backdrop-blur-xl sm:p-10">
        <div className="mb-10 flex items-center gap-3">
          <div className="brand-mark brand-mark-light"><ShieldCheck size={22} /></div>
          <div>
            <p className="text-sm font-bold tracking-[.18em] text-ink">IP SENTINEL</p>
            <p className="mt-0.5 text-xs text-slate-400">教师办公网络管理</p>
          </div>
        </div>
        <p className="eyebrow">SECURE CONSOLE</p>
        <h1 className="mt-3 text-[30px] font-semibold tracking-[-.04em] text-ink">欢迎回来</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">登录后台，查看全校教师办公 IP 的实时状态。</p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="field-label">
            管理员密码
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="输入管理员密码"
              className="field-input mt-2"
            />
          </label>
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}
          <Button type="submit" disabled={loading} size="lg" className="mt-2 w-full">
            {loading ? <RefreshCw size={17} className="animate-spin" /> : <ArrowUpRight size={17} />}
            {loading ? '正在验证…' : '进入管理后台'}
          </Button>
        </form>
        <p className="mt-8 flex items-center gap-2 text-xs leading-5 text-slate-400"><CircleHelp size={14} />首次部署请及时修改默认管理员密码。</p>
      </section>
    </main>
  );
};

const StatCard = ({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  icon: typeof Activity;
  tone: 'mint' | 'amber' | 'rose' | 'ink';
}): React.JSX.Element => (
  <div className="stat-card group">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="mt-3 text-[31px] font-semibold tracking-[-.05em] text-ink">{value.toLocaleString('zh-CN')}</p>
      </div>
      <div className={`stat-icon stat-icon-${tone}`}><Icon size={19} /></div>
    </div>
    <p className="mt-5 flex items-center gap-1.5 text-xs text-slate-400"><span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />{hint}</p>
  </div>
);

const Topbar = ({
  page,
  onRefresh,
  refreshing,
  onMenu,
  onImport,
  lastUpdated,
}: {
  page: Page;
  onRefresh: () => void;
  refreshing: boolean;
  onMenu: () => void;
  onImport: () => void;
  lastUpdated: string;
}): React.JSX.Element => {
  const titles: Record<Page, [string, string]> = {
    overview: ['总览', '实时掌握全校网络合规情况'],
    teachers: ['教师名单', '管理教师 IP 分配与设备状态'],
    events: ['检测事件', '查看每一次上报与处理结果'],
  };
  return (
    <header className="topbar">
      <div className="flex min-w-0 items-center gap-3">
        <button className="icon-button lg:hidden" onClick={onMenu} aria-label="打开导航"><Menu size={20} /></button>
        <div className="min-w-0"><p className="eyebrow">{titles[page][1]}</p><h1 className="mt-1 truncate text-xl font-semibold tracking-[-.03em] text-ink sm:text-2xl">{titles[page][0]}</h1></div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-2 text-xs text-slate-400 xl:flex"><span className="live-dot" />实时连接 · {lastUpdated ? formatTime(lastUpdated) : '等待数据'}</div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> <span className="hidden sm:inline">刷新</span></Button>
        <Button variant="mint" size="sm" onClick={onImport}><CloudUpload size={15} /> <span className="hidden sm:inline">导入名单</span></Button>
      </div>
    </header>
  );
};

const Sidebar = ({ page, setPage, open, onClose, onLogout }: { page: Page; setPage: (page: Page) => void; open: boolean; onClose: () => void; onLogout: () => void }): React.JSX.Element => {
  const items: Array<{ id: Page; label: string; icon: typeof LayoutDashboard; note?: string }> = [
    { id: 'overview', label: '监测总览', icon: LayoutDashboard },
    { id: 'teachers', label: '教师名单', icon: UsersRound },
    { id: 'events', label: '检测事件', icon: Activity },
  ];
  return (
    <>
      {open && <button className="sidebar-overlay lg:hidden" onClick={onClose} aria-label="关闭导航" />}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="flex items-center gap-3 px-3">
          <div className="brand-mark"><ShieldCheck size={20} /></div>
          <div><p className="text-[13px] font-bold tracking-[.16em] text-white">IP SENTINEL</p><p className="mt-0.5 text-[10px] tracking-[.08em] text-slate-500">SCHOOL NETWORK OS</p></div>
          <button className="ml-auto text-slate-500 lg:hidden" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="mt-12 px-3"><p className="nav-heading">工作台</p><nav className="mt-3 space-y-1">{items.map(({ id, label, icon: Icon, note }) => <button key={id} onClick={() => { setPage(id); onClose(); }} className={`nav-item ${page === id ? 'nav-item-active' : ''}`}><Icon size={17} strokeWidth={page === id ? 2.4 : 1.8} /><span>{label}</span>{note && <span className="ml-auto rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-400">{note}</span>}{page === id && <span className="nav-active-bar" />}</button>)}</nav></div>
        <div className="mt-10 px-3"><p className="nav-heading">系统</p><nav className="mt-3 space-y-1"><button className="nav-item"><Settings2 size={17} /><span>系统设置</span><span className="ml-auto text-[10px] text-slate-600">即将推出</span></button><button className="nav-item"><CircleHelp size={17} /><span>帮助与文档</span></button></nav></div>
        <div className="mt-auto px-3">
          <div className="server-card"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,.13)]" /><span className="text-xs font-semibold text-slate-200">服务正常</span></div><Server size={15} className="text-slate-500" /></div><p className="mt-3 text-[11px] leading-5 text-slate-500">API 18080 · 管理台 18081</p></div>
          <button onClick={onLogout} className="mt-4 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-slate-500 transition hover:bg-white/5 hover:text-white"><LogOut size={16} />退出登录</button>
          <div className="mt-4 border-t border-white/10 pt-4 text-[10px] text-slate-600">IP Sentinel v0.2.3 · 2026</div>
        </div>
      </aside>
    </>
  );
};

const OverviewPage = ({ overview, events, teachers, onImport }: { overview: Overview | null; events: EventItem[]; teachers: Teacher[]; onImport: () => void }): React.JSX.Element => {
  const complianceRate = overview?.enabled ? Math.round(((overview.compliant ?? 0) / overview.enabled) * 100) : 0;
  const bars = useMemo(() => {
    const base = Math.max(3, overview?.compliant ?? 0);
    return [0.62, 0.78, 0.57, 0.9, 0.74, 0.86, 1].map((ratio, index) => Math.max(3, Math.round(base * ratio) + index));
  }, [overview?.compliant]);
  return (
    <div className="space-y-5">
      <section className="hero-card">
        <div className="relative z-10 max-w-[620px]"><p className="eyebrow text-mint/70">NETWORK PULSE · LIVE</p><h2 className="mt-3 text-2xl font-semibold tracking-[-.045em] text-white sm:text-[30px]">让每一台办公电脑，<span className="text-mint">都在正确的位置。</span></h2><p className="mt-3 max-w-[520px] text-sm leading-6 text-slate-400">名单、设备和网络状态集中在这里。发现异常时，教师可以在客户端完成一次透明、可回滚的修复。</p><button onClick={onImport} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-white/15"><FileSpreadsheet size={15} />导入最新 IP 名单<ArrowUpRight size={14} /></button></div>
        <div className="hero-grid" /><div className="hero-glow" /><div className="hero-signal"><Signal size={18} /><span>MONITORING</span><strong>24/7</strong></div>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="纳管教师" value={overview?.enabled ?? 0} hint={`名单共 ${overview?.total ?? 0} 人`} icon={UsersRound} tone="ink" />
        <StatCard label="当前在线" value={overview?.online ?? 0} hint="近 3 分钟有心跳" icon={Activity} tone="mint" />
        <StatCard label="网络合规" value={overview?.compliant ?? 0} hint={`${complianceRate}% 配置匹配`} icon={ShieldCheck} tone="mint" />
        <StatCard label="需要关注" value={overview?.actionRequired ?? 0} hint="异常或待处理状态" icon={AlertTriangle} tone="rose" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
        <section className="panel-card min-h-[318px]">
          <div className="flex items-start justify-between"><div><p className="panel-kicker">ACTIVITY OVERVIEW</p><h3 className="panel-title">监测活动</h3></div><div className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-500">近 7 天 <ChevronDown size={13} className="ml-1 inline" /></div></div>
          <div className="mt-8 flex h-[190px] items-end gap-2 sm:gap-4">{bars.map((height, index) => <div key={index} className="flex flex-1 flex-col items-center gap-3"><div className={`relative w-full max-w-[46px] rounded-t-lg ${index === bars.length - 1 ? 'bg-ink' : 'bg-slate-100'}`} style={{ height: `${Math.min(100, height / Math.max(...bars) * 100)}%` }}><div className="absolute inset-x-0 bottom-0 rounded-t-lg bg-mint" style={{ height: `${index === bars.length - 1 ? 75 : 50 + index * 4}%` }} /></div><span className="text-[10px] text-slate-400">{['周一', '周二', '周三', '周四', '周五', '周六', '今天'][index]}</span></div>)}</div>
        </section>
        <section className="panel-card min-h-[318px]"><div><p className="panel-kicker">COMPLIANCE RATE</p><h3 className="panel-title">合规分布</h3></div><div className="mt-7 flex items-center justify-center gap-7"><div className="donut" style={{ '--rate': `${complianceRate * 3.6}deg` } as React.CSSProperties}><div className="donut-inner"><strong>{complianceRate}%</strong><span>合规率</span></div></div><div className="space-y-4 text-sm"><Legend color="bg-ink" label="配置合规" value={overview?.compliant ?? 0} /><Legend color="bg-rose-400" label="需要关注" value={overview?.actionRequired ?? 0} /><Legend color="bg-slate-200" label="待连接" value={overview?.unbound ?? 0} /></div></div><div className="mt-7 flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-3 text-xs"><span className="text-slate-500">最后更新</span><span className="font-medium text-slate-700">{formatFullTime(overview?.generatedAt)}</span></div></section>
      </div>
      <section className="panel-card overflow-hidden p-0"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-5 sm:px-6"><div><p className="panel-kicker">LATEST SIGNALS</p><h3 className="panel-title">最近检测</h3></div><button className="text-xs font-semibold text-slate-500 transition hover:text-ink">查看全部 <ArrowUpRight size={13} className="ml-1 inline" /></button></div><RecentEvents events={events.slice(0, 6)} /></section>
      {teachers.length === 0 && <section className="panel-card"><EmptyState icon={FileSpreadsheet} title="还没有导入教师名单" description="上传目录中的 XLSX 文件，后台会先校验字段和网络配置，再一次性提交。" /></section>}
    </div>
  );
};

const Legend = ({ color, label, value }: { color: string; label: string; value: number }): React.JSX.Element => <div className="flex min-w-[105px] items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${color}`} /><span className="text-slate-500">{label}</span><strong className="ml-auto text-ink">{value}</strong></div>;

const RecentEvents = ({ events }: { events: EventItem[] }): React.JSX.Element => events.length ? <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>教师</th><th>当前 IP</th><th>状态</th><th>时间</th><th /></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td><div className="flex items-center gap-3"><div className="avatar">{event.name.slice(0, 1)}</div><div><p className="font-semibold text-ink">{event.name}</p><p className="mt-0.5 text-xs text-slate-400">{event.location || (event.macAddress ? `MAC ${formatMac(event.macAddress)}` : '未标注位置')}</p></div></div></td><td><span className="font-mono text-xs text-slate-600">{event.observedIp || '—'}</span></td><td><StatusPill status={event.result} /></td><td><span className="text-xs text-slate-400" title={formatFullTime(event.createdAt)}>{formatTime(event.createdAt)}</span></td><td><button className="icon-button icon-button-small"><MoreHorizontal size={16} /></button></td></tr>)}</tbody></table></div> : <EmptyState icon={Activity} title="等待第一条检测事件" description="客户端上线并发送心跳后，最新活动会显示在这里。" />;

const TeachersPage = ({ teachers, onRevoke, onEdit }: { teachers: Teacher[]; onRevoke: (teacher: Teacher) => void; onEdit: (teacher: Teacher) => void }): React.JSX.Element => {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const filtered = useMemo(() => teachers.filter((teacher) => (!query || `${teacher.name}${teacher.location ?? ''}${teacher.assignment?.ip ?? ''}`.toLowerCase().includes(query.toLowerCase())) && (status === 'all' || teacher.status === status)), [teachers, query, status]);
  return <div className="space-y-5"><section className="panel-card p-0"><div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 lg:flex-row lg:items-center lg:justify-between sm:px-6"><div><p className="panel-kicker">DIRECTORY</p><h3 className="panel-title">教师 IP 名单 <span className="ml-2 align-middle rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">{teachers.length}</span></h3></div><div className="flex flex-col gap-2 sm:flex-row"><label className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="field-input h-9 w-full pl-9 text-xs sm:w-[190px]" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、地点或 IP" /></label><select className="field-input h-9 min-w-[130px] text-xs" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="compliant">合规</option><option value="non_compliant">IP 不一致</option><option value="modifying">修改中</option><option value="offline">离线</option></select></div></div>{filtered.length ? <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>教师</th><th>分配配置</th><th>网卡 MAC</th><th>状态</th><th>最近心跳</th><th /></tr></thead><tbody>{filtered.map((teacher) => <tr key={teacher.id}><td><div className="flex items-center gap-3"><div className="avatar avatar-mint">{teacher.name.slice(0, 1)}</div><div><p className="font-semibold text-ink">{teacher.name}</p><p className="mt-0.5 text-xs text-slate-400">{teacher.location || '未标注地点'}</p></div></div></td><td>{teacher.assignment ? <div><p className="font-mono text-xs font-medium text-slate-700">{teacher.assignment.ip}<span className="text-slate-400">/{teacher.assignment.prefix}</span></p><p className="mt-1 text-[11px] text-slate-400">GW {teacher.assignment.gateway}</p></div> : <span className="text-xs text-slate-400">未配置</span>}</td><td>{teacher.device ? <div><p className="font-mono text-xs font-medium text-slate-600">{formatMac(teacher.device.macAddress)}</p><p className="mt-1 text-[11px] text-slate-400">v{teacher.device.clientVersion || '—'}</p></div> : <span className="text-xs text-slate-400">未绑定</span>}</td><td><StatusPill status={teacher.status} /></td><td><span className="text-xs text-slate-400" title={formatFullTime(teacher.device?.lastSeen)}>{formatTime(teacher.device?.lastSeen)}</span></td><td><div className="flex items-center justify-end gap-1"><button onClick={() => onEdit(teacher)} className="icon-button icon-button-small" title="编辑教师信息"><Pencil size={15} /></button><button onClick={() => onRevoke(teacher)} className="icon-button icon-button-small" title="撤销设备绑定"><MoreHorizontal size={16} /></button></div></td></tr>)}</tbody></table></div> : <EmptyState icon={UsersRound} title="没有匹配的教师" description="尝试调整搜索词或状态筛选。" />}</section></div>;
};

const EventsPage = ({ events, onClear }: { events: EventItem[]; onClear: () => void }): React.JSX.Element => <div className="space-y-5"><section className="panel-card p-0"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-5 sm:px-6"><div><p className="panel-kicker">AUDIT TRAIL</p><h3 className="panel-title">检测事件 <span className="ml-2 align-middle rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">{events.length}</span></h3></div><Button variant="outline" size="sm" onClick={onClear} disabled={!events.length}><span className="text-rose-500">清空日志</span></Button></div>{events.length ? <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>时间</th><th>教师</th><th>观测配置</th><th>网卡 MAC</th><th>结果</th><th>说明</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td className="whitespace-nowrap"><span className="text-xs text-slate-500">{formatFullTime(event.createdAt)}</span></td><td><div className="flex items-center gap-2.5"><div className="avatar avatar-small">{event.name.slice(0, 1)}</div><span className="font-semibold text-ink">{event.name}</span></div></td><td><p className="font-mono text-xs text-slate-600">{event.observedIp || '—'}{event.observedPrefix !== null ? `/${event.observedPrefix}` : ''}</p><p className="mt-1 text-[11px] text-slate-400">GW {event.observedGateway || '—'}</p></td><td><span className="font-mono text-xs text-slate-600">{formatMac(event.macAddress)}</span></td><td><StatusPill status={event.result} /></td><td className="min-w-[260px]"><span className="text-xs leading-5 text-slate-500">{event.reason || '—'}</span></td></tr>)}</tbody></table></div> : <EmptyState icon={Clock3} title="暂时没有检测事件" description="事件会按时间倒序显示，并保留设备上报的处理结果。" />}</section></div>;

const TeacherEditDialog = ({ teacher, onClose, onDone }: { teacher: Teacher | null; onClose: () => void; onDone: () => void }): React.JSX.Element | null => {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [hasAssignment, setHasAssignment] = useState(true);
  const [ip, setIp] = useState('');
  const [prefix, setPrefix] = useState('24');
  const [gateway, setGateway] = useState('');
  const [dns, setDns] = useState('');
  const [interfaceHint, setInterfaceHint] = useState('');
  const [assignmentEnabled, setAssignmentEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!teacher) return;
    setName(teacher.name);
    setLocation(teacher.location ?? '');
    setEnabled(teacher.enabled);
    setHasAssignment(Boolean(teacher.assignment));
    setIp(teacher.assignment?.ip ?? '');
    setPrefix(String(teacher.assignment?.prefix ?? 24));
    setGateway(teacher.assignment?.gateway ?? '');
    setDns((teacher.assignment?.dns ?? []).join(', '));
    setInterfaceHint(teacher.assignment?.interfaceHint ?? '');
    setAssignmentEnabled(teacher.assignment?.enabled !== false);
    setError('');
  }, [teacher]);

  if (!teacher) return null;
  const save = async (): Promise<void> => {
    const numericPrefix = Number(prefix);
    if (hasAssignment && (!Number.isInteger(numericPrefix) || numericPrefix < 0 || numericPrefix > 32)) {
      setError('前缀长度必须是 0 到 32 的整数');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.updateTeacher(teacher.id, {
        name: name.trim(),
        location: location.trim() || null,
        enabled,
        assignment: hasAssignment ? {
          ip: ip.trim(),
          prefix: numericPrefix,
          gateway: gateway.trim(),
          dns: dns.split(/[,，;；\s]+/).map((value) => value.trim()).filter(Boolean),
          interfaceHint: interfaceHint.trim() || null,
          enabled: assignmentEnabled,
        } : null,
      });
      onDone();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card max-h-[92vh] max-w-[720px] overflow-y-auto"><div className="flex items-start justify-between"><div><p className="panel-kicker">TEACHER PROFILE</p><h2 className="mt-2 text-xl font-semibold tracking-[-.03em] text-ink">编辑教师信息</h2><p className="mt-2 text-sm text-slate-500">修改后会立即同步到客户端，下次心跳将使用新的网络配置。</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="mt-7 grid gap-4 sm:grid-cols-2"><label className="field-label">教师姓名<input className="field-input mt-2" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field-label">办公地点<input className="field-input mt-2" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="例如：教学楼 302" /></label></div><label className="mt-4 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="accent-slate-900" />启用教师账号</label><div className="mt-7 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5"><div className="flex items-start justify-between gap-4"><div><p className="font-semibold text-ink">网络分配</p><p className="mt-1 text-xs leading-5 text-slate-400">关闭后将移除该教师的 IP 配置，客户端不会再收到修改任务。</p></div><label className="flex shrink-0 items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={hasAssignment} onChange={(event) => setHasAssignment(event.target.checked)} className="accent-slate-900" />配置 IP</label></div>{hasAssignment && <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="field-label">IPv4 地址<input className="field-input mt-2 font-mono" value={ip} onChange={(event) => setIp(event.target.value)} placeholder="10.0.0.10" /></label><label className="field-label">前缀长度<input className="field-input mt-2 font-mono" inputMode="numeric" value={prefix} onChange={(event) => setPrefix(event.target.value)} placeholder="24" /></label><label className="field-label">网关<input className="field-input mt-2 font-mono" value={gateway} onChange={(event) => setGateway(event.target.value)} placeholder="10.0.0.1" /></label><label className="field-label">DNS（可填多个）<input className="field-input mt-2 font-mono" value={dns} onChange={(event) => setDns(event.target.value)} placeholder="10.0.0.1, 223.5.5.5" /></label><label className="field-label sm:col-span-2">网卡提示（可选）<input className="field-input mt-2" value={interfaceHint} onChange={(event) => setInterfaceHint(event.target.value)} placeholder="例如：以太网" /></label><label className="flex items-center gap-2 text-xs font-semibold text-slate-600 sm:col-span-2"><input type="checkbox" checked={assignmentEnabled} onChange={(event) => setAssignmentEnabled(event.target.checked)} className="accent-slate-900" />启用此网络配置</label></div>}</div>{error && <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-600">{error}</div>}<div className="mt-7 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>取消</Button><Button variant="mint" onClick={() => void save()} disabled={saving}>{saving && <RefreshCw size={15} className="animate-spin" />}{saving ? '保存中…' : '保存修改'}</Button></div></section></div>;
};

const ImportDialog = ({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }): React.JSX.Element | null => {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [fullSync, setFullSync] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!open) { setPreview(null); setError(''); setFullSync(false); } }, [open]);
  if (!open) return null;
  const choose = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setLoading(true); setError('');
    try { setPreview(await api.previewImport(file)); } catch (reason) { setError(reason instanceof Error ? reason.message : '解析失败'); } finally { setLoading(false); }
  };
  const commit = async (): Promise<void> => {
    if (!preview) return;
    setCommitting(true); setError('');
    try { await api.commitImport(preview.id, fullSync); onDone(); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : '提交失败'); } finally { setCommitting(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card"><div className="flex items-start justify-between"><div><p className="panel-kicker">IMPORT CENTER</p><h2 className="mt-2 text-xl font-semibold tracking-[-.03em] text-ink">导入教师 IP 名单</h2><p className="mt-2 text-sm text-slate-500">支持当前目录中的表格格式，系统会自动识别第 2 行表头并转换子网掩码。</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div>{!preview && <button onClick={() => inputRef.current?.click()} className="upload-zone mt-7"><input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => void choose(event.target.files?.[0])} /><div className="upload-icon">{loading ? <RefreshCw size={21} className="animate-spin" /> : <CloudUpload size={21} />}</div><p className="mt-4 font-semibold text-ink">{loading ? '正在校验文件…' : '点击选择 XLSX 文件'}</p><p className="mt-1 text-xs text-slate-400">最大 10 MB · 先预览，后提交</p></button>}{preview && <div className="mt-7"><div className="grid grid-cols-3 gap-2"><ImportMetric label="总行数" value={preview.totalRows} /><ImportMetric label="可导入" value={preview.validRows} tone="mint" /><ImportMetric label="错误行" value={preview.errorRows} tone={preview.errorRows ? 'rose' : 'default'} /></div><div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50/70 p-4"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-emerald-600 shadow-sm"><FileSpreadsheet size={17} /></div><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{preview.filename}</p><p className="mt-1 truncate font-mono text-[10px] text-slate-400">SHA-256 · {preview.fileSha256}</p></div><Check size={17} className="ml-auto text-emerald-500" /></div></div><div className="mt-4 max-h-48 overflow-auto rounded-2xl border border-slate-100"><table className="data-table data-table-compact"><thead><tr><th>行</th><th>教师</th><th>IP</th><th>状态</th></tr></thead><tbody>{preview.rows.slice(0, 80).map((row) => <tr key={row.sourceRow}><td>{row.sourceRow}</td><td>{row.name || '—'}</td><td className="font-mono">{row.ip || '—'}</td><td>{row.valid ? <span className="text-xs text-emerald-600">通过</span> : <span className="text-xs text-rose-600">{row.errors[0] || '错误'}</span>}</td></tr>)}</tbody></table></div><label className="mt-4 flex cursor-pointer items-start gap-2 text-xs leading-5 text-slate-500"><input type="checkbox" checked={fullSync} onChange={(event) => setFullSync(event.target.checked)} className="mt-1 accent-slate-900" />按文件全量同步：文件中不存在的教师将被停用。默认仅新增或更新文件中的记录。</label></div>}{error && <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-600">{error}</div>}<div className="mt-7 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>取消</Button>{preview && <Button variant="mint" onClick={() => void commit()} disabled={committing || preview.errorRows > 0}>{committing ? <RefreshCw size={15} className="animate-spin" /> : <Check size={15} />}{committing ? '提交中…' : '确认导入'}</Button>}</div></section></div>;
};

const ImportMetric = ({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'mint' | 'rose' }): React.JSX.Element => <div className={`rounded-2xl border px-3 py-3 ${tone === 'mint' ? 'border-[#d8f5e7] bg-[#f2fdf8]' : tone === 'rose' ? 'border-rose-100 bg-rose-50' : 'border-slate-100 bg-slate-50/70'}`}><p className="text-[11px] text-slate-400">{label}</p><p className="mt-1 text-xl font-semibold text-ink">{value}</p></div>;

const App = (): React.JSX.Element => {
  const [authenticated, setAuthenticated] = useState(Boolean(sessionStorage.getItem(api.tokenKey)));
  const [page, setPage] = useState<Page>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [editTeacher, setEditTeacher] = useState<Teacher | null>(null);
  const [toast, setToast] = useState('');

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      const [nextOverview, nextTeachers, nextEvents] = await Promise.all([api.overview(), api.teachers({}), api.events()]);
      setOverview(nextOverview); setTeachers(nextTeachers.data); setEvents(nextEvents.data); setLastUpdated(new Date().toISOString());
    } catch (reason) {
      if (reason instanceof Error && reason.message.includes('管理员登录')) { api.logout(); setAuthenticated(false); }
      else setToast(reason instanceof Error ? reason.message : '数据加载失败');
    } finally { setRefreshing(false); }
  };
  useEffect(() => { if (authenticated) void refresh(); }, [authenticated]);
  useEffect(() => { if (!authenticated) return undefined; const close = openAdminStream(() => void refresh()); return close; }, [authenticated]);
  useEffect(() => { if (!toast) return undefined; const timer = window.setTimeout(() => setToast(''), 3500); return () => window.clearTimeout(timer); }, [toast]);
  if (!authenticated) return <LoginScreen onLogin={() => setAuthenticated(true)} />;
  const logout = (): void => { api.logout(); setAuthenticated(false); };
  const revoke = async (teacher: Teacher): Promise<void> => { if (!window.confirm(`确定撤销 ${teacher.name} 的设备绑定吗？`)) return; try { await api.revokeDevices(teacher.id); setToast(`已撤销 ${teacher.name} 的设备绑定`); await refresh(); } catch (reason) { setToast(reason instanceof Error ? reason.message : '操作失败'); } };
  const clearEvents = async (): Promise<void> => { if (!window.confirm('确定清空全部检测日志吗？此操作不可恢复。')) return; try { const result = await api.clearEvents(); setEvents([]); setToast(`已清空 ${result.deleted} 条检测日志`); await refresh(); } catch (reason) { setToast(reason instanceof Error ? reason.message : '清空日志失败'); } };
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} open={sidebarOpen} onClose={() => setSidebarOpen(false)} onLogout={logout} /><main className="main-shell"><Topbar page={page} onRefresh={() => void refresh()} refreshing={refreshing} onMenu={() => setSidebarOpen(true)} onImport={() => setImportOpen(true)} lastUpdated={lastUpdated} /><div className="content-shell">{page === 'overview' && <OverviewPage overview={overview} events={events} teachers={teachers} onImport={() => setImportOpen(true)} />}{page === 'teachers' && <TeachersPage teachers={teachers} onRevoke={(teacher) => void revoke(teacher)} onEdit={setEditTeacher} />}{page === 'events' && <EventsPage events={events} onClear={() => void clearEvents()} />}</div></main><ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={() => { setToast('名单导入成功，实时名单已更新'); void refresh(); }} /><TeacherEditDialog teacher={editTeacher} onClose={() => setEditTeacher(null)} onDone={() => { setToast('教师信息已更新'); void refresh(); }} />{toast && <div className="toast"><Check size={15} className="text-emerald-500" />{toast}<button onClick={() => setToast('')}><X size={14} /></button></div>}</div>;
};

export default App;
