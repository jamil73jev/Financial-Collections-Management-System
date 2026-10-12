import { useState, useEffect, useCallback } from 'react';
import { Search, Filter, CreditCard, Calendar, CheckCircle2, XCircle, Clock } from 'lucide-react';
import api from '../services/api';
import { Table } from '../components/common/Table';

const ESTADOS = {
  'PENDIENTE': { color: 'bg-amber-50 text-amber-600 border-amber-100', icon: Clock },
  'ACTIVO':    { color: 'bg-blue-50 text-blue-600 border-blue-100',   icon: CheckCircle2 },
  'CANCELADO': { color: 'bg-emerald-50 text-emerald-600 border-emerald-100', icon: CheckCircle2 },
  'INCUMPLIDO':{ color: 'bg-rose-50 text-rose-600 border-rose-100',   icon: XCircle },
};

export default function Convenios() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [estado, setEstado] = useState('');
  const [ruc, setRuc] = useState('');

  const fetchConvenios = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/convenios/', {
        params: { page, page_size: pageSize, estado, ruc }
      });
      setData(response.data.data);
      setTotal(response.data.total);
    } catch (err) {
      console.error('Error fetching convenios:', err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, estado, ruc]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchConvenios();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchConvenios]);

  const columns = [
    { 
      header: 'Referencia / RUC', 
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-bold text-slate-800">{row.nroDocumento || 'S/N'}</span>
          <span className="text-[10px] text-slate-400 font-medium">{row.ruc}</span>
        </div>
      )
    },
    { 
      header: 'Contribuyente', 
      cell: (row) => (
        <span className="text-xs font-semibold text-slate-700">{row.nombreContribuyente || 'N/D'}</span>
      )
    },
    { 
      header: 'Monto Total', 
      cell: (row) => (
        <div className="flex flex-col text-right">
          <span className="font-bold text-slate-900">$ {Number(row.montoTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          <span className="text-[10px] text-slate-400">En {row.nroCuotas} cuotas</span>
        </div>
      )
    },
    { 
      header: 'Estado', 
      cell: (row) => {
        const est = row.estado || 'PENDIENTE';
        const config = ESTADOS[est] || ESTADOS['PENDIENTE'];
        const Icon = config.icon;
        return (
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${config.color} uppercase`}>
            <Icon className="w-3 h-3" />
            {est}
          </div>
        );
      }
    },
    { 
      header: 'Avance', 
      cell: (row) => {
        const pagado = Number(row.montoPagado || 0);
        const total = Number(row.montoTotal || 1);
        const pct = Math.min(100, Math.round((pagado / total) * 100));
        return (
          <div className="flex flex-col gap-1.5 w-32">
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
              <span>{pct}%</span>
              <span>$ {pagado.toLocaleString()} pagado</span>
            </div>
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-1000" 
                style={{ width: `${pct}%` }}
              ></div>
            </div>
          </div>
        );
      }
    },
    { 
      header: 'Fecha Inicio', 
      cell: (row) => (
        <span className="text-xs text-slate-500">
          {row.fechaConvenio ? new Date(row.fechaConvenio).toLocaleDateString() : 'N/D'}
        </span>
      )
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Convenios de Pago</h2>
          <p className="text-slate-500 text-sm mt-1">Gestión de acuerdos de pago diferido para contribuyentes con cartera vencida.</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/20">
          <CreditCard className="w-4 h-4" />
          Nuevo Convenio
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[300px] relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
          <input 
            type="text" 
            placeholder="Buscar por RUC o Nro Documento..." 
            value={ruc}
            onChange={(e) => { setRuc(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
          />
        </div>
        
        <div className="flex items-center gap-3">
          <select 
            value={estado}
            onChange={(e) => { setEstado(e.target.value); setPage(1); }}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600 focus:outline-none focus:border-blue-500"
          >
            <option value="">Todos los Estados</option>
            {Object.keys(ESTADOS).map(e => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 min-h-[500px]">
        <Table 
          columns={columns}
          data={data}
          loading={loading}
          pagination={{
            page,
            limit: pageSize,
            total,
            current_rows: data.length
          }}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
