import { useState, useEffect, useCallback } from 'react';
import { Search, Filter, AlertTriangle, TrendingDown, ArrowRight, Download } from 'lucide-react';
import api from '../services/api';
import { Table } from '../components/common/Table';

const MORA_COLORS = {
  'MORA_LEVE':    'bg-blue-50 text-blue-600 border-blue-100',
  'MORA_MEDIA':   'bg-amber-50 text-amber-600 border-amber-100',
  'MORA_ALTA':    'bg-orange-50 text-orange-600 border-orange-100',
  'MORA_CRITICA': 'bg-rose-50 text-rose-600 border-rose-100',
  'COACTIVA':     'bg-slate-900 text-white border-slate-900',
};

const PRIORIDAD_COLORS = {
  'BAJA':    'text-slate-400',
  'MEDIA':   'text-amber-500',
  'ALTA':    'text-orange-500',
  'CRITICA': 'text-rose-600 font-black',
};

export default function Morosidad() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [clasificacion, setClasificacion] = useState('');
  const [minDeuda, setMinDeuda] = useState('');

  const fetchMorosidad = useCallback(async () => {
    setLoading(true);
    try {
      const skip = (page - 1) * limit;
      const response = await api.get('/api/morosidad', {
        params: { skip, limit, clasificacion, minDeuda }
      });
      setData(response.data.data);
      setTotal(response.data.total);
    } catch (err) {
      console.error('Error fetching morosidad:', err);
    } finally {
      setLoading(false);
    }
  }, [page, limit, clasificacion, minDeuda]);

  useEffect(() => {
    fetchMorosidad();
  }, [fetchMorosidad]);

  const columns = [
    { 
      header: 'Contribuyente', 
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-bold text-slate-800">{row.NombreContribuyente}</span>
          <span className="text-[10px] text-slate-400 font-medium">{row.Ruc}</span>
        </div>
      )
    },
    { 
      header: 'Deuda Vencida', 
      cell: (row) => (
        <span className="font-bold text-rose-600">
          $ {Number(row.deudaVencida || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      )
    },
    { 
      header: 'Días Mora', 
      cell: (row) => (
        <div className="flex items-center gap-1.5">
          <span className={`text-xs font-bold ${row.diasMora > 365 ? 'text-rose-600' : 'text-slate-600'}`}>
            {row.diasMora}
          </span>
          <span className="text-[10px] text-slate-400 font-medium">días</span>
        </div>
      )
    },
    { 
      header: 'Clasificación', 
      cell: (row) => {
        const cls = row.clasificacionMora || 'MORA_LEVE';
        return (
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${MORA_COLORS[cls] || MORA_COLORS.MORA_LEVE}`}>
            {cls.replace('_', ' ')}
          </span>
        );
      }
    },
    { 
      header: 'Prioridad', 
      cell: (row) => (
        <span className={`text-[10px] font-black uppercase tracking-widest ${PRIORIDAD_COLORS[row.prioridadGestion] || 'text-slate-400'}`}>
          {row.prioridadGestion || 'NORMAL'}
        </span>
      )
    },
    { 
      header: 'Acción', 
      cell: (row) => (
        <button className="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold text-xs group">
          Gestionar <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </button>
      )
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <AlertTriangle className="text-rose-500 w-7 h-7" />
            Análisis de Morosidad
          </h2>
          <p className="text-slate-500 text-sm mt-1">Identificando contribuyentes críticos por tiempo y monto de deuda.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-rose-50 border border-rose-100 px-4 py-2 rounded-xl flex items-center gap-3">
            <TrendingDown className="text-rose-600 w-5 h-5" />
            <div className="leading-tight">
              <p className="text-[10px] text-rose-400 font-bold uppercase tracking-wider">Cartera Vencida</p>
              <p className="text-sm font-black text-rose-700">$ 36,245,120.40</p>
            </div>
          </div>
          <button className="p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm">
            <Download className="w-5 h-5 text-slate-600" />
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-4">
        <select 
          value={clasificacion}
          onChange={(e) => { setClasificacion(e.target.value); setPage(1); }}
          className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600 focus:outline-none focus:border-blue-500"
        >
          <option value="">Todas las Clases</option>
          <option value="MORA_LEVE">Mora Leve</option>
          <option value="MORA_MEDIA">Mora Media</option>
          <option value="MORA_ALTA">Mora Alta</option>
          <option value="MORA_CRITICA">Mora Crítica</option>
          <option value="COACTIVA">Coactiva</option>
        </select>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400">Mínimo $</span>
          <input 
            type="number" 
            placeholder="0.00" 
            value={minDeuda}
            onChange={(e) => { setMinDeuda(e.target.value); setPage(1); }}
            className="w-32 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="flex-1 min-h-[600px]">
        <Table 
          columns={columns}
          data={data}
          loading={loading}
          pagination={{
            page,
            limit,
            total,
            current_rows: data.length
          }}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
