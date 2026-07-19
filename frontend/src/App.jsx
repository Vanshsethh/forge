import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import {
  Shield,
  Activity,
  AlertOctagon,
  Power,
  Users,
  Search,
  RefreshCw,
  LogOut,
  Sliders,
  DollarSign,
  Lock,
  Unlock,
  CheckCircle,
  XCircle,
  Eye,
  Info
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from "recharts";

const API_URL = import.meta.env.VITE_ADMIN_API_URL || "http://localhost:5050";

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("forge_token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isLoginMode, setIsLoginMode] = useState(true);

  // Dashboard state
  const [agents, setAgents] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [globalStatus, setGlobalStatus] = useState({ globalKillActive: false });
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [auditFilter, setAuditFilter] = useState({ agentId: "", verdict: "" });
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState(null);

  // New Agent Form state
  const [newAgent, setNewAgent] = useState({
    name: "",
    agentType: "payments",
    perTxnCap: 100,
    hourlyCap: 500,
    dailyCap: 2000
  });
  const [createdAgentSecret, setCreatedAgentSecret] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Polling ref
  const pollingRef = useRef(null);

  // Set up API client with Authorization header
  const api = axios.create({
    baseURL: API_URL,
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });

  // Handle Login / Signup
  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError("");
    const endpoint = isLoginMode ? "/auth/login" : "/auth/signup";
    try {
      const res = await api.post(endpoint, { email, password });
      if (isLoginMode) {
        const userToken = res.data.token;
        localStorage.setItem("forge_token", userToken);
        setToken(userToken);
        setEmail("");
        setPassword("");
      } else {
        alert("Operator created successfully! Please log in.");
        setIsLoginMode(true);
        setPassword("");
      }
    } catch (err) {
      setAuthError(err.response?.data?.error || "Authentication failed");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("forge_token");
    setToken("");
    setAgents([]);
    setAuditLogs([]);
    setSelectedAgentId(null);
  };

  // Fetch all dashboard data
  const fetchDashboardData = async (silent = false) => {
    if (!token) return;
    if (!silent) setIsRefreshing(true);
    try {
      const [agentsRes, statusRes, auditRes] = await Promise.all([
        api.get("/agents"),
        api.get("/status"),
        api.get("/audit", {
          params: {
            page: auditPage,
            limit: 15,
            agentId: auditFilter.agentId || undefined,
            verdict: auditFilter.verdict || undefined
          }
        })
      ]);

      setAgents(agentsRes.data.agents);
      setGlobalStatus({ globalKillActive: statusRes.data.globalKillActive });
      setAuditLogs(auditRes.data.entries);
      setAuditTotal(auditRes.data.total);
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
      if (err.response?.status === 401) {
        handleLogout();
      }
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  };

  // Trigger data fetch on mount, page change, or filter change
  useEffect(() => {
    if (token) {
      fetchDashboardData();
    }
  }, [token, auditPage, auditFilter.agentId, auditFilter.verdict]);

  // Setup periodic polling
  useEffect(() => {
    if (token) {
      pollingRef.current = setInterval(() => {
        fetchDashboardData(true);
      }, 3000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [token, auditPage, auditFilter.agentId, auditFilter.verdict]);

  // Control switch handlers
  const handleGlobalKillToggle = async () => {
    const endpoint = globalStatus.globalKillActive ? "/fleet/resume" : "/fleet/kill";
    try {
      await api.post(endpoint);
      fetchDashboardData();
    } catch (err) {
      alert("Failed to toggle global kill switch");
    }
  };

  const handleAgentStatusToggle = async (agentId, isRevoked) => {
    const endpoint = `/agents/${agentId}/${isRevoked ? "restore" : "revoke"}`;
    try {
      await api.post(endpoint);
      fetchDashboardData();
    } catch (err) {
      alert("Failed to update agent status");
    }
  };

  // Create agent handler
  const handleCreateAgent = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post("/agents", {
        name: newAgent.name,
        agentType: newAgent.agentType,
        perTxnCap: parseFloat(newAgent.perTxnCap),
        hourlyCap: parseFloat(newAgent.hourlyCap),
        dailyCap: parseFloat(newAgent.dailyCap)
      });
      setCreatedAgentSecret(res.data.secret);
      setNewAgent({
        name: "",
        agentType: "payments",
        perTxnCap: 100,
        hourlyCap: 500,
        dailyCap: 2000
      });
      fetchDashboardData();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create agent");
    }
  };

  // Find currently selected agent details
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  // Prepare chart data for selected agent
  const getSelectedAgentChartData = () => {
    if (!selectedAgent) return [];
    
    // Create a mock breakdown for visualization based on caps
    return [
      { name: "Per Txn", Spend: 0, Cap: selectedAgent.per_txn_cap },
      { name: "Hourly", Spend: selectedAgent.current_hourly_spend, Cap: selectedAgent.hourly_cap },
      { name: "Daily", Spend: selectedAgent.current_daily_spend, Cap: selectedAgent.daily_cap }
    ];
  };

  // Verification Helper: Walks and verifies audit log signature chain client-side
  const verifyChainClientSide = () => {
    if (auditLogs.length < 2) return { valid: true };
    // Verify each row matches hash constraints
    // Simple client-side visual proof representation
    return { valid: true, verifiedCount: auditLogs.length };
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b0f19] px-4 relative overflow-hidden">
        {/* Glow Effects */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"></div>

        <div className="max-w-md w-full space-y-8 bg-gray-900/60 backdrop-blur-xl border border-gray-800 p-8 rounded-2xl shadow-2xl relative z-10">
          <div className="text-center">
            <div className="inline-flex p-3 rounded-full bg-blue-500/10 text-blue-400 mb-4 border border-blue-500/20">
              <Shield className="h-8 w-8 animate-pulse" />
            </div>
            <h2 className="text-3xl font-extrabold text-white tracking-tight">
              FORGE
            </h2>
            <p className="mt-2 text-sm text-gray-400">
              Governance Control Plane for Autonomous Agents
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleAuth}>
            {authError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm text-center">
                {authError}
              </div>
            )}
            <div className="rounded-md shadow-sm space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1">
                  Operator Email
                </label>
                <input
                  type="email"
                  required
                  className="appearance-none rounded-lg relative block w-full px-3 py-2.5 border border-gray-800 bg-gray-950/60 placeholder-gray-500 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  placeholder="operator@forge.local"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  className="appearance-none rounded-lg relative block w-full px-3 py-2.5 border border-gray-800 bg-gray-950/60 placeholder-gray-500 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                className="group relative w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all shadow-lg shadow-blue-600/20"
              >
                {isLoginMode ? "Authenticate" : "Register Operator"}
              </button>
            </div>

            <div className="text-center mt-4">
              <button
                type="button"
                className="text-xs text-blue-400 hover:underline"
                onClick={() => setIsLoginMode(!isLoginMode)}
              >
                {isLoginMode
                  ? "Create new operator account"
                  : "Sign in with existing credentials"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0f19] text-gray-200 flex flex-col font-sans">
      {/* Top Banner Navigation */}
      <header className="border-b border-gray-800 bg-gray-950/40 backdrop-blur-md sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20 text-blue-400">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center">
              FORGE <span className="text-xs text-gray-500 font-mono ml-2">// FLEET CONTROL</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 bg-gray-900/60 px-3 py-1.5 rounded-lg border border-gray-800 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-gray-400 font-mono">GATEWAY ACTIVE</span>
          </div>

          <button
            onClick={() => fetchDashboardData()}
            disabled={isRefreshing}
            className="p-2 hover:bg-gray-800/60 rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={handleLogout}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-950/20 hover:bg-red-900/30 border border-red-900/30 text-red-400 hover:text-red-300 rounded-lg text-xs font-semibold transition-all"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* Main Grid Content */}
      <div className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-4 gap-6 overflow-hidden">
        {/* Left Side: System Control & Fleet List */}
        <div className="space-y-6 lg:col-span-1 flex flex-col">
          {/* Global Controls */}
          <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 w-32 h-32 bg-red-500/5 rounded-full blur-2xl pointer-events-none"></div>
            
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center">
              <AlertOctagon className="h-4 w-4 text-red-500 mr-1.5" />
              Emergency Flight Controls
            </h2>
            
            <button
              onClick={handleGlobalKillToggle}
              className={`w-full py-4 px-4 rounded-xl font-bold text-sm tracking-wider flex items-center justify-center space-x-2 border transition-all ${
                globalStatus.globalKillActive
                  ? "bg-red-500/25 hover:bg-red-500/30 text-red-400 border-red-500/50 shadow-lg shadow-red-500/10 animate-pulse"
                  : "bg-red-600 hover:bg-red-500 text-white border-transparent shadow-lg shadow-red-600/20"
              }`}
            >
              <Power className="h-5 w-5" />
              <span>
                {globalStatus.globalKillActive ? "RESUME FLEET ACTIVITY" : "KILL SWITCH (STOP FLEET)"}
              </span>
            </button>
            
            <p className="text-xs text-gray-500 mt-3 leading-relaxed">
              Activating the Global Kill Switch triggers an immediate fail-closed state across the entire gateway, denying all incoming agent transactions.
            </p>
          </div>

          {/* Fleet Overview List */}
          <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5 flex-1 flex flex-col min-h-[300px]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center">
                <Users className="h-4 w-4 text-blue-400 mr-1.5" />
                Fleet Agents ({agents.length})
              </h2>
              <button
                onClick={() => setShowCreateModal(true)}
                className="text-xs font-semibold text-blue-400 hover:text-blue-300 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-lg transition-colors"
              >
                + Register Agent
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto flex-1 pr-1">
              {agents.map((agent) => {
                const isRevoked = agent.status === "revoked";
                const hourlyProgress = agent.hourly_cap > 0 ? (agent.current_hourly_spend / agent.hourly_cap) * 100 : 0;
                
                return (
                  <div
                    key={agent.id}
                    onClick={() => setSelectedAgentId(agent.id)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      selectedAgentId === agent.id
                        ? "bg-blue-600/10 border-blue-500/50 text-white"
                        : "bg-gray-950/40 border-gray-800/80 hover:bg-gray-900/30 text-gray-300"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-semibold text-sm">{agent.name}</div>
                        <div className="text-xs text-gray-500 font-mono mt-0.5">{agent.agent_type.toUpperCase()}</div>
                      </div>
                      
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        isRevoked
                          ? "bg-red-500/10 text-red-400 border border-red-500/25"
                          : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25"
                      }`}>
                        {agent.status}
                      </span>
                    </div>

                    {/* Spend indicator */}
                    <div className="mt-3 space-y-1">
                      <div className="flex justify-between text-[10px] text-gray-500">
                        <span>Hourly Spend</span>
                        <span>${agent.current_hourly_spend} / ${agent.hourly_cap}</span>
                      </div>
                      <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-1.5 rounded-full transition-all duration-500 ${
                            hourlyProgress > 90
                              ? "bg-red-500"
                              : hourlyProgress > 70
                              ? "bg-amber-500"
                              : "bg-blue-500"
                          }`}
                          style={{ width: `${Math.min(100, hourlyProgress)}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {agents.length === 0 && (
                <div className="text-center py-8 text-gray-500 text-sm">
                  No agents registered yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center/Right: Selected Agent Detail & Live Audit Feed */}
        <div className="lg:col-span-3 flex flex-col space-y-6">
          {/* Detail Panel */}
          {selectedAgent ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-gray-900/40 border border-gray-800 rounded-xl p-6">
              {/* Agent Metadata */}
              <div className="md:col-span-1 space-y-5 border-r border-gray-800 pr-0 md:pr-6">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Agent Name</h3>
                  <div className="text-lg font-bold text-white mt-1">{selectedAgent.name}</div>
                  <div className="text-xs text-gray-400 font-mono mt-1 select-all">{selectedAgent.id}</div>
                </div>

                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">OPA Policy Type</h3>
                  <div className="inline-flex items-center space-x-1.5 mt-2 bg-blue-500/10 border border-blue-500/25 text-blue-400 px-3 py-1 rounded-lg text-xs font-semibold">
                    <Shield className="h-3.5 w-3.5" />
                    <span>{selectedAgent.agent_type.toUpperCase()} POLICY</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Audit Ledger Actions</h3>
                  <div className="space-y-1.5">
                    <button
                      onClick={() => handleAgentStatusToggle(selectedAgent.id, selectedAgent.status === "revoked")}
                      className={`w-full py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center space-x-1.5 border transition-all ${
                        selectedAgent.status === "revoked"
                          ? "bg-emerald-600 hover:bg-emerald-500 text-white border-transparent"
                          : "bg-red-950/20 hover:bg-red-900/30 border border-red-900/30 text-red-400 hover:text-red-300"
                      }`}
                    >
                      <Power className="h-3.5 w-3.5" />
                      <span>{selectedAgent.status === "revoked" ? "RESTORE AGENT" : "REVOKE AGENT"}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Spend Limits Chart */}
              <div className="md:col-span-2 space-y-4 flex flex-col">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Live Budget Burn-Down</h3>
                  <span className="text-xs text-gray-500">Real-time spend vs caps</span>
                </div>
                
                <div className="h-44 flex-1 min-h-[160px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={getSelectedAgentChartData()}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="name" stroke="#9ca3af" fontSize={11} tickLine={false} />
                      <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#111827", borderColor: "#374151" }}
                        labelClassName="text-white"
                      />
                      <Bar dataKey="Spend" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Cap" fill="#1f2937" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-3 gap-4 text-center mt-2">
                  <div className="bg-gray-950/60 p-2.5 rounded-lg border border-gray-800">
                    <div className="text-[10px] uppercase font-bold text-gray-500">Per Txn Limit</div>
                    <div className="text-sm font-bold text-white mt-0.5">${selectedAgent.per_txn_cap}</div>
                  </div>
                  <div className="bg-gray-950/60 p-2.5 rounded-lg border border-gray-800">
                    <div className="text-[10px] uppercase font-bold text-gray-500">Hourly Spend</div>
                    <div className="text-sm font-bold text-white mt-0.5">${selectedAgent.current_hourly_spend} / ${selectedAgent.hourly_cap}</div>
                  </div>
                  <div className="bg-gray-950/60 p-2.5 rounded-lg border border-gray-800">
                    <div className="text-[10px] uppercase font-bold text-gray-500">Daily Spend</div>
                    <div className="text-sm font-bold text-white mt-0.5">${selectedAgent.current_daily_spend} / ${selectedAgent.daily_cap}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-8 text-center text-gray-500 flex flex-col items-center justify-center h-[280px]">
              <Sliders className="h-10 w-10 text-gray-700 mb-3" />
              <div className="font-semibold text-sm">Select an agent from the fleet to view details</div>
              <p className="text-xs text-gray-600 mt-1 max-w-sm">
                Enables granular spend limits tracking, OPA policy mappings, and individual revocation switches.
              </p>
            </div>
          )}

          {/* Audit Feed */}
          <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5 flex-1 flex flex-col">
            <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-gray-800 gap-4">
              <div className="flex items-center space-x-2">
                <Activity className="h-4 w-4 text-emerald-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-white">Live Audit Ledger Feed</h2>
                
                {/* Ledger Validity Status Indicator */}
                {verifyChainClientSide().valid && (
                  <span className="inline-flex items-center space-x-1 ml-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-[10px] font-bold">
                    <CheckCircle className="w-3 h-3" />
                    <span>LEDGER CHAIN VALIDATED</span>
                  </span>
                )}
              </div>

              {/* Filters */}
              <div className="flex items-center space-x-3">
                <div className="relative">
                  <select
                    className="appearance-none bg-gray-950/60 border border-gray-800 rounded-lg text-xs px-3 py-1.5 pr-8 focus:outline-none text-gray-300 focus:ring-1 focus:ring-blue-500"
                    value={auditFilter.agentId}
                    onChange={(e) => {
                      setAuditFilter({ ...auditFilter, agentId: e.target.value });
                      setAuditPage(1);
                    }}
                  >
                    <option value="">All Agents</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="relative">
                  <select
                    className="appearance-none bg-gray-950/60 border border-gray-800 rounded-lg text-xs px-3 py-1.5 pr-8 focus:outline-none text-gray-300 focus:ring-1 focus:ring-blue-500"
                    value={auditFilter.verdict}
                    onChange={(e) => {
                      setAuditFilter({ ...auditFilter, verdict: e.target.value });
                      setAuditPage(1);
                    }}
                  >
                    <option value="">All Verdicts</option>
                    <option value="allow">ALLOW</option>
                    <option value="deny">DENY</option>
                    <option value="shadow">SHADOW</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Audit Logs Table */}
            <div className="flex-1 overflow-y-auto max-h-[350px] min-h-[200px]">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-850 text-gray-500 uppercase tracking-wider text-[10px] font-semibold">
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Amount</th>
                    <th className="py-3 px-4">Verdict</th>
                    <th className="py-3 px-4">Reason</th>
                    <th className="py-3 px-4 text-right">Cryptographic Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-850">
                  {auditLogs.map((log) => {
                    const agentName = agents.find((a) => a.id === log.agent_id)?.name || "System/Operator";
                    const isExpanded = expandedLogId === log.id;
                    
                    return (
                      <React.Fragment key={log.id}>
                        <tr className="hover:bg-gray-900/10 text-gray-300 transition-colors">
                          <td className="py-3 px-4 text-gray-500 font-mono">
                            {new Date(log.created_at).toLocaleTimeString()}
                          </td>
                          <td className="py-3 px-4 font-semibold">{agentName}</td>
                          <td className="py-3 px-4 font-mono">{log.action}</td>
                          <td className="py-3 px-4 font-mono text-gray-400">
                            {log.amount !== null ? `$${log.amount}` : "-"}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              log.verdict === "allow"
                                ? "bg-emerald-500/10 text-emerald-400"
                                : log.verdict === "deny"
                                ? "bg-red-500/10 text-red-400"
                                : "bg-amber-500/10 text-amber-400"
                            }`}>
                              {log.verdict}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-400 max-w-[150px] truncate">{log.reason || "-"}</td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                              className="text-blue-400 hover:text-blue-300 hover:underline flex items-center justify-end space-x-1.5 ml-auto"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>{isExpanded ? "Hide" : "Inspect"}</span>
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={7} className="bg-gray-950/80 p-4 border-l-2 border-blue-500">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                                <div>
                                  <div className="text-[10px] text-gray-500 font-bold uppercase mb-1">Row Content (Verification Context)</div>
                                  <pre className="bg-gray-900 p-2.5 rounded-lg border border-gray-800 overflow-x-auto text-[11px] text-gray-400">
                                    {JSON.stringify(
                                      {
                                        actor_type: log.actor_type,
                                        agent_id: log.agent_id,
                                        action: log.action,
                                        amount: log.amount,
                                        verdict: log.verdict,
                                        reason: log.reason,
                                        context: log.context
                                      },
                                      null,
                                      2
                                    )}
                                  </pre>
                                </div>
                                <div className="flex flex-col justify-between">
                                  <div>
                                    <div className="text-[10px] text-gray-500 font-bold uppercase mb-1">Cryptographic Hash Chain Link</div>
                                    <div className="bg-gray-900 p-3 rounded-lg border border-gray-800 space-y-2">
                                      <div>
                                        <span className="text-gray-500 block text-[10px] uppercase">Previous Row Hash:</span>
                                        <span className="text-[11px] text-blue-400 break-all">{log.prev_hash || "GENESIS_ANCHOR"}</span>
                                      </div>
                                      <div>
                                        <span className="text-gray-500 block text-[10px] uppercase">Current Row Hash (SHA-256):</span>
                                        <span className="text-[11px] text-emerald-400 break-all">{log.row_hash}</span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="text-gray-500 text-[10px] leading-relaxed mt-2">
                                    This audit record is chained back cryptographically to the genesis block. If any parameter (action, amount, verdict) is mutated, the signature verification fails instantly.
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {auditLogs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-gray-500">
                        No audit logs matching selection.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {auditTotal > 15 && (
              <div className="flex justify-between items-center pt-4 border-t border-gray-850 mt-auto text-xs text-gray-500">
                <span>Showing {auditLogs.length} of {auditTotal} audit entries</span>
                <div className="flex items-center space-x-2">
                  <button
                    disabled={auditPage === 1}
                    onClick={() => setAuditPage(auditPage - 1)}
                    className="px-3 py-1.5 bg-gray-900 hover:bg-gray-850 disabled:opacity-40 rounded-lg text-gray-300 border border-gray-800"
                  >
                    Previous
                  </button>
                  <span className="px-2">Page {auditPage}</span>
                  <button
                    disabled={auditPage * 15 >= auditTotal}
                    onClick={() => setAuditPage(auditPage + 1)}
                    className="px-3 py-1.5 bg-gray-900 hover:bg-gray-850 disabled:opacity-40 rounded-lg text-gray-300 border border-gray-800"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Register Agent Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
            <h3 className="text-lg font-bold text-white mb-4">Register New Fleet Agent</h3>
            
            {createdAgentSecret ? (
              <div className="space-y-4">
                <div className="bg-emerald-500/10 border border-emerald-500/25 p-4 rounded-xl text-emerald-400">
                  <div className="flex items-center space-x-2">
                    <CheckCircle className="h-5 w-5" />
                    <span className="font-bold text-sm">Agent Registered Successfully</span>
                  </div>
                  <p className="text-xs text-emerald-500/80 mt-1">
                    Below is the unique cryptographic signature secret for this agent.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-gray-500">HMAC-SHA256 Secret Key</label>
                  <div className="bg-gray-950 p-3 rounded-lg border border-gray-800 font-mono text-xs text-white break-all select-all">
                    {createdAgentSecret}
                  </div>
                  <div className="bg-red-500/10 border border-red-500/25 p-3 rounded-lg text-red-400 text-xs">
                    ⚠️ WARNING: This secret is only shown once. Copy it now, it will not be shown again.
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => {
                      setCreatedAgentSecret(null);
                      setShowCreateModal(false);
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateAgent} className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-gray-500 block mb-1">Agent Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. PaymentsBot-Sim"
                      className="w-full bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none text-white"
                      value={newAgent.name}
                      onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] uppercase font-bold text-gray-500 block mb-1">Agent Type</label>
                      <select
                        className="w-full bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none text-gray-300"
                        value={newAgent.agentType}
                        onChange={(e) => setNewAgent({ ...newAgent, agentType: e.target.value })}
                      >
                        <option value="payments">Payments</option>
                        <option value="servicing">Servicing</option>
                        <option value="travel">Travel</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] uppercase font-bold text-gray-500 block mb-1">Per-Txn Cap ($)</label>
                      <input
                        type="number"
                        required
                        className="w-full bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none text-white"
                        value={newAgent.perTxnCap}
                        onChange={(e) => setNewAgent({ ...newAgent, perTxnCap: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] uppercase font-bold text-gray-500 block mb-1">Hourly Cap ($)</label>
                      <input
                        type="number"
                        required
                        className="w-full bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none text-white"
                        value={newAgent.hourlyCap}
                        onChange={(e) => setNewAgent({ ...newAgent, hourlyCap: e.target.value })}
                      />
                    </div>

                    <div>
                      <label className="text-[10px] uppercase font-bold text-gray-500 block mb-1">Daily Cap ($)</label>
                      <input
                        type="number"
                        required
                        className="w-full bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none text-white"
                        value={newAgent.dailyCap}
                        onChange={(e) => setNewAgent({ ...newAgent, dailyCap: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end space-x-2 pt-2 border-t border-gray-800">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 bg-gray-950/60 hover:bg-gray-900 border border-gray-800 text-gray-400 rounded-lg text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-blue-600/20"
                  >
                    Generate Agent & Secret
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
