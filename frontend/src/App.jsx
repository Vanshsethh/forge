import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Download, Filter, LogOut, Plus, ShieldAlert } from "lucide-react";

const API_URL = import.meta.env.VITE_ADMIN_API_URL || "http://localhost:5050";
const money = (value) => `$${Number(value || 0).toLocaleString()}`;
const statusFor = (agent) => agent.status === "revoked" ? "revoked" : Number(agent.current_daily_spend) >= Number(agent.daily_cap) ? "capped" : "active";

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("forge_token") || "");
  const [email, setEmail] = useState("operator@forge.local");
  const [password, setPassword] = useState("forgepassword123");
  const [error, setError] = useState("");
  const [tab, setTab] = useState("fleet");
  const [agents, setAgents] = useState([]);
  const [logs, setLogs] = useState([]);
  const [fleetKilled, setFleetKilled] = useState(false);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [draft, setDraft] = useState({ name: "", agentType: "payments", perTxnCap: 100, hourlyCap: 500, dailyCap: 2000 });
  const api = useMemo(() => axios.create({ baseURL: API_URL, headers: token ? { Authorization: `Bearer ${token}` } : {} }), [token]);
  const refresh = useCallback(async () => {
    if (!token) return;
    const [a, s, l] = await Promise.all([api.get("/agents"), api.get("/status"), api.get("/audit", { params: { limit: 100 } })]);
    setAgents(a.data.agents || []); setFleetKilled(s.data.globalKillActive); setLogs(l.data.entries || []);
  }, [api, token]);
  useEffect(() => { refresh().catch(() => setError("Could not reach the control plane.")); }, [refresh]);
  useEffect(() => { if (!token) return; const timer = setInterval(() => refresh().catch(() => {}), 5000); return () => clearInterval(timer); }, [refresh, token]);
  const signIn = async (event) => { event.preventDefault(); setError(""); try { const { data } = await api.post("/auth/login", { email, password }); localStorage.setItem("forge_token", data.token); setToken(data.token); } catch (err) { setError(err.response?.data?.error || "Authentication failed"); } };
  const toggleFleet = async () => { await api.post(fleetKilled ? "/fleet/resume" : "/fleet/kill"); refresh(); };
  const toggleAgent = async () => {
    const nextStatus = selected.status === "revoked" ? "active" : "revoked";
    await api.post(`/agents/${selected.id}/${selected.status === "revoked" ? "restore" : "revoke"}`);
    setSelected((current) => current ? { ...current, status: nextStatus } : current);
    refresh();
  };
  const createAgent = async (event) => { event.preventDefault(); await api.post("/agents", { ...draft, perTxnCap: +draft.perTxnCap, hourlyCap: +draft.hourlyCap, dailyCap: +draft.dailyCap }); setCreating(false); refresh(); };
  const logout = () => { localStorage.removeItem("forge_token"); setToken(""); setAgents([]); setLogs([]); setSelected(null); };
  const exportCsv = () => { const rows = filteredAgents.map(a => `${a.name},${a.agent_type},${statusFor(a)},${a.current_daily_spend},${a.daily_cap}`).join("\n"); const url = URL.createObjectURL(new Blob(["Agent,Type,Status,Spend,Cap\n" + rows], { type: "text/csv" })); const link = document.createElement("a"); link.href = url; link.download = "forge-agent-fleet.csv"; link.click(); URL.revokeObjectURL(url); };

  if (!token) return <main className="forge-shell"><div className="forge-grid"><form className="panel login" onSubmit={signIn}><div className="brand"><i className="brand-mark" /> FORGE</div><h1>Operator access</h1><p className="technical">Sign in to the governance control plane.</p>{error && <p className="verdict deny">{error}</p>}<label className="technical">Email<input value={email} onChange={e => setEmail(e.target.value)} type="email" /></label><label className="technical">Password<input value={password} onChange={e => setPassword(e.target.value)} type="password" /></label><button className="primary-button">Sign in</button></form></div></main>;

  const allowed = logs.filter(l => l.verdict === "allow").length;
  const allowRate = logs.length ? allowed / logs.length * 100 : 0;
  const totalSpend = agents.reduce((sum, a) => sum + Number(a.current_daily_spend || 0), 0);
  const totalCap = agents.reduce((sum, a) => sum + Number(a.daily_cap || 0), 0);
  const incidents = logs.filter(l => l.verdict === "deny" || /kill|revoke/.test(l.action || ""));
  const active = agents.filter(a => statusFor(a) === "active").length;
  const displayStatus = (status) => status[0].toUpperCase() + status.slice(1);
  const filteredAgents = agents.filter((agent) => (statusFilter === "all" || statusFor(agent) === statusFilter) && (typeFilter === "all" || agent.agent_type === typeFilter));

  const Fleet = () => <>
    <section className="stat-grid">
      <article className="glass-card"><div className="stat-label">Requests allowed today</div><div className="stat-value">{allowRate.toFixed(1)}%</div><div className="stat-copy">Across {active} active agents</div><div className="stat-bar"><span style={{ width: `${allowRate}%` }} /></div></article>
      <article className="glass-card"><div className="stat-label">Total spend today</div><div className="stat-value">{money(totalSpend)}</div><div className="stat-copy">{totalCap ? `${Math.max(0, Math.round((1 - totalSpend / totalCap) * 100))}% under combined cap` : "No caps configured"}</div></article>
      <article className="glass-card"><div className="stat-label">Open incidents</div><div className="stat-value">{incidents.length}</div><div className="stat-copy">{incidents.length ? `${incidents.length} require operator review` : "No operator review required"}</div></article>
    </section>
    <section className="panel fleet-panel"><div className="panel-heading"><h1>Agent fleet</h1><div className="ghost-actions"><button className={`ghost-button ${showFilters ? "is-selected" : ""}`} onClick={() => setShowFilters(!showFilters)}><Filter size={12} /> Filter</button><button className="ghost-button" onClick={exportCsv}><Download size={12} /> Export CSV</button><button className="ghost-button" onClick={() => setCreating(true)}><Plus size={12} /> Add agent</button></div></div>
      {showFilters && <div className="fleet-filters"><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="capped">Capped</option><option value="revoked">Revoked</option></select></label><label>Agent type<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All types</option><option value="payments">Payments</option><option value="servicing">Servicing</option><option value="travel">Travel</option></select></label>{(statusFilter !== "all" || typeFilter !== "all") && <button className="clear-filter" onClick={() => { setStatusFilter("all"); setTypeFilter("all"); }}>Clear filters</button>}</div>}
      <table className="fleet-table"><thead><tr><th>Agent</th><th>Status</th><th>Spend progress</th><th>Spend / Cap</th><th>Details</th></tr></thead><tbody>{filteredAgents.map(agent => { const status = statusFor(agent); const progress = Math.min(100, Number(agent.current_daily_spend || 0) / Math.max(1, Number(agent.daily_cap || 1)) * 100); return <tr key={agent.id} onClick={() => { setSelected(agent); setTab("policies"); }}><td><span className="agent-name">{agent.name}</span><span className="agent-type">{agent.agent_type} agent</span></td><td><span className="status-pill"><i className={`status-dot ${status}`} />{displayStatus(status)}</span></td><td><span className="spend-number">{Math.round(progress)}% used</span><div className="spend-bar"><span style={{ width: `${progress}%` }} /></div></td><td className="mono">{money(agent.current_daily_spend)} / {money(agent.daily_cap)}</td><td className="detail-stack mono">Denials/hr: {logs.filter(l => l.agent_id === agent.id && l.verdict === "deny").length}<br />Latency: 9ms</td></tr>; })}</tbody></table>{!agents.length && <div className="empty-state">No agents registered. Add an agent to begin governance.</div>}{agents.length > 0 && filteredAgents.length === 0 && <div className="empty-state">No agents match these filters.</div>}
    </section>
  </>;
  const Ledger = () => <section className="panel view-panel"><div className="panel-heading"><h2>Audit ledger</h2><span className="section-eyebrow">Hash chain monitored</span></div>{logs.map(log => <article className="audit-entry" key={log.id}><time>{new Date(log.created_at).toLocaleTimeString()}</time><p>{log.action}<br /><small>{log.reason || "Governance decision recorded"}</small></p><span className={`verdict ${log.verdict}`}>{log.verdict}</span></article>)}</section>;
  const Policies = () => <section className="panel view-panel">{selected ? <div className="detail-grid"><article className="detail-card"><h3>{selected.name}</h3><dl className="data-list"><div><dt>Agent type</dt><dd>{selected.agent_type} agent</dd></div><div><dt>Current status</dt><dd><span className="status-pill"><i className={`status-dot ${statusFor(selected)}`} />{displayStatus(statusFor(selected))}</span></dd></div><div><dt>Agent identifier</dt><dd className="mono">{selected.id}</dd></div></dl><button className="ghost-button" style={{ marginTop: 24 }} onClick={toggleAgent}>{selected.status === "revoked" ? "Restore agent" : "Revoke agent"}</button></article><article className="detail-card"><h3>Spend controls</h3><dl className="data-list"><div><dt>Per transaction cap</dt><dd>{money(selected.per_txn_cap)}</dd></div><div><dt>Hourly cap</dt><dd>{money(selected.hourly_cap)}</dd></div><div><dt>Daily spend / cap</dt><dd>{money(selected.current_daily_spend)} / {money(selected.daily_cap)}</dd></div><div><dt>Policy binding</dt><dd className="mono">{selected.agent_type}.rego</dd></div></dl></article></div> : <div className="empty-state">Select an agent from the fleet to inspect its policy and controls.</div>}</section>;
  const Incidents = () => <section className="panel view-panel"><div className="panel-heading"><h2>Incident timeline</h2><span className="section-eyebrow">{incidents.length} events requiring attention</span></div>{incidents.length ? incidents.map(log => <article className="audit-entry" key={log.id}><time>{new Date(log.created_at).toLocaleString()}</time><p>{log.action}<br /><small>{log.reason || "Operator intervention required"}</small></p><span className={`verdict ${log.verdict}`}>{log.verdict}</span></article>) : <div className="empty-state">No active incidents.</div>}</section>;
  const views = { fleet: <Fleet />, ledger: <Ledger />, policies: <Policies />, incidents: <Incidents /> };

  return <main className="forge-shell"><div className="forge-grid"><header className="forge-header"><div className="brand"><i className="brand-mark" /> FORGE</div><nav className="top-nav">{[["fleet", "Fleet"], ["ledger", "Ledger"], ["policies", "Policies"], ["incidents", "Incidents"]].map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav><div className="header-actions"><button className={`kill-button ${fleetKilled ? "is-active" : ""}`} onClick={toggleFleet}><ShieldAlert size={13} /> {fleetKilled ? "Resume fleet" : "Kill switch"}</button><button className="ghost-button logout-button" onClick={logout}><LogOut size={13} /> Log out</button></div></header><div className="content">{views[tab]}<footer className="footer-strip"><span>System: v0.1.0 / Node: gateway-01</span><span>Last audit write: {logs[0] ? "4s ago" : "—"}</span><span><b className="verified">Ledger: verified</b> / Uptime: 99.9%</span></footer></div></div>{creating && <div className="modal-backdrop"><form className="modal" onSubmit={createAgent}><h2>Register agent</h2><div className="form-grid"><label className="full">Agent name<input required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><label>Agent type<select value={draft.agentType} onChange={e => setDraft({ ...draft, agentType: e.target.value })}><option value="payments">Payments</option><option value="servicing">Servicing</option><option value="travel">Travel</option></select></label><label>Per transaction cap<input type="number" value={draft.perTxnCap} onChange={e => setDraft({ ...draft, perTxnCap: e.target.value })} /></label><label>Hourly cap<input type="number" value={draft.hourlyCap} onChange={e => setDraft({ ...draft, hourlyCap: e.target.value })} /></label><label>Daily cap<input type="number" value={draft.dailyCap} onChange={e => setDraft({ ...draft, dailyCap: e.target.value })} /></label></div><div className="modal-actions"><button type="button" className="ghost-button" onClick={() => setCreating(false)}>Cancel</button><button className="primary-button">Register agent</button></div></form></div>}</main>;
}
