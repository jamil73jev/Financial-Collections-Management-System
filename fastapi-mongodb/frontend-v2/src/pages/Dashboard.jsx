import { useState, useEffect } from 'react';
import { 
  Users, 
  CreditCard, 
  AlertTriangle, 
  TrendingUp, 
  ArrowUpRight, 
  ArrowDownRight,
  RefreshCw
} from 'lucide-react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area,
  PieChart, Pie, Cell
} from 'recharts';
import { motion } from 'framer-motion';
import api from '../services/api';
import { Skeleton, KpiSkeleton, ChartSkeleton } from '../components/common/Skeleton';

const KpiCard = ({ title, value, sub, icon: Icon, color, trend, loading, delay = 0 }) => {
  if (loading) return <KpiSkeleton />;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      whileHover={{ y: -5, transition: { duration: 0.2 } }}
      className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300 group"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-slate-500 text-[11px] font-black uppercase tracking-widest">{title}</p>
          <h3 className="text-3xl font-black text-slate-900 mt-2 tracking-tight">{value}</h3>
          <div className="flex items-center gap-1.5 mt-3">
            {trend !== undefined && (
              trend > 0 ? (
                <span className="flex items-center text-emerald-600 text-[10px] font-black bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100">
                  <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> +{trend}%
                </span>
              ) : (
                <span className="flex items-center text-rose-600 text-[10px] font-black bg-rose-50 px-2 py-1 rounded-lg border border-rose-100">
                  <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" /> {Math.abs(trend)}%
                </span>
              )
            )}
            <span className="text-slate-400 text-[10px] font-bold uppercase">{sub}</span>
          </div>
        </div>
        <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center shadow-lg shadow-current/20 text-white transform group-hover:scale-110 transition-transform duration-300`}>
          <Icon className="w-7 h-7" />
        </div>
      </div>
    </motion.div>
  );
};

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [kpisRes, moraRes, recRes] = await Promise.all([
        api.get('/api/powerbi/kpis-snapshot'),
        api.get('/api/morosidad/kpis'),
        api.get('/api/powerbi/recaudacion?anios=1')
      ]);
      setData({
        snapshot: kpisRes.data,
        mora: moraRes.data,
        recaudacion: recRes.data.datos || [],
      });
      setError(null);
    } catch (err) {
      console.error('Error fetching KPIs:', err);
      setError('No se pudo cargar la información del dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const formatUsd = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  if (error) return <div className="p-8 text-rose-500 bg-rose-50 rounded-xl border border-rose-100">{error}</div>;

  const chartData = data?.recaudacion || [];
  const mora = data?.mora || {};
  const statusData = [
    { name: 'Al Día', value: mora.alDia?.count || 0, color: '#10b981' },
    { name: 'Mora', value: (mora.moraLeve?.count || 0) + (mora.moraMedia?.count || 0) + (mora.moraAlta?.count || 0) + (mora.moraCritica?.count || 0), color: '#f59e0b' },
    { name: 'Coactiva', value: mora.coactiva?.count || 0, color: '#ef4444' },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Dashboard Ejecutivo</h2>
          <p className="text-slate-500 mt-1 font-medium">Sintetizando la gestión de recaudación municipal en tiempo real.</p>
        </div>
        <button 
          onClick={fetchData}
          className="p-3 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 transition-all shadow-sm hover:shadow-md active:scale-95"
        >
          <RefreshCw className={`w-5 h-5 text-slate-600 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </motion.div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard 
          title="Padrón Municipal" 
          value={data?.snapshot?.total_contribuyentes?.toLocaleString() || '0'} 
          sub="Contribuyentes" 
          icon={Users} 
          color="bg-blue-600" 
          loading={loading}
          delay={0.1}
        />
        <KpiCard 
          title="Deuda Vigente" 
          value={formatUsd(data?.snapshot?.deuda_total || 0)} 
          sub="Saldo total" 
          icon={TrendingUp} 
          color="bg-violet-600" 
          trend={2.4}
          loading={loading}
          delay={0.2}
        />
        <KpiCard 
          title="Recaudación Efectiva" 
          value={(data?.snapshot?.notif_cobradas_mes || 0).toLocaleString()} 
          sub="Notificaciones cobradas" 
          icon={CreditCard} 
          color="bg-emerald-600" 
          trend={1.8}
          loading={loading}
          delay={0.3}
        />
        <KpiCard 
          title="Cartera en Mora" 
          value={formatUsd(data?.mora?.montoVencido || 0)} 
          sub={`${data?.mora?.totalEnMora?.toLocaleString() || 0} contribuyentes`} 
          icon={AlertTriangle} 
          color="bg-rose-500" 
          trend={-0.5}
          loading={loading}
          delay={0.4}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {loading ? (
          <>
            <div className="lg:col-span-2"><ChartSkeleton /></div>
            <ChartSkeleton />
          </>
        ) : (
          <>
            {/* Main Chart */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5 }}
              className="lg:col-span-2 bg-white p-8 rounded-3xl border border-slate-100 shadow-sm flex flex-col"
            >
              <div className="flex items-center justify-between mb-6">
                <h4 className="font-bold text-slate-800">Tendencia de Recaudación</h4>
                <div className="flex gap-4">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500"></div>
                    <span className="text-[11px] font-medium text-slate-500">Recaudación Mensual</span>
                  </div>
                </div>
              </div>
              <div className="flex-1 h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorRec" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="periodo" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{fill: '#94a3b8', fontSize: 11}} 
                      dy={10}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{fill: '#94a3b8', fontSize: 11}}
                      tickFormatter={(val) => `$${val/1000}k`}
                    />
                    <Tooltip 
                      contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px'}}
                      formatter={(val) => formatUsd(val)}
                    />
                    <Area type="monotone" dataKey="deuda_gestionada" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorRec)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            {/* Side Chart (Pie) */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.6 }}
              className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm flex flex-col"
            >
              <h4 className="font-bold text-slate-800 mb-6">Distribución de Cartera</h4>
              <div className="flex-1 h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-3 mt-6">
                {statusData.map((item) => (
                  <div key={item.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: item.color}}></div>
                      <span className="text-xs text-slate-600 font-medium">{item.name}</span>
                    </div>
                    <span className="text-xs font-bold text-slate-900">{item.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}
