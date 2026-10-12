import { useState, useEffect, useCallback } from 'react';
import { Search, Filter, Download, UserPlus, FileText } from 'lucide-react';
import api from '../services/api';
import { Table } from '../components/common/Table';

export default function Contribuyentes() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [search, setSearch] = useState('');
  const [estado, setEstado] = useState('');
  const [zona, setZona] = useState('');

  const fetchContribuyentes = useCallback(async () => {
    setLoading(true);
    try {
      const skip = (page - 1) * limit;
      const response = await api.get('/api/contribuyentes', {
        params: { skip, limit, search, estado, zona }
      });
      setData(response.data.data);
      setTotal(response.data.total);
    } catch (err) {
      console.error('Error fetching taxpayers:', err);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, estado, zona]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchContribuyentes();
    }, 300); // Debounce search
    return () => clearTimeout(timer);
  }, [fetchContribuyentes]);

  const columns = [
    { 
      header: 'Contribuyente', 
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-bold text-slate-800">{row.NombreContribuyente}</span>
          <span className="text-[11px] text-slate-400 font-medium">{row.Ruc}</span>
        </div>
      )
    },
    { header: 'Tipo', accessor: 'TipoPersona' },
    { header: 'Representante', accessor: 'RepresentanteLegal' },
    { 
      header: 'Estado', 
      cell: (row) => {
        const est = row.EstadoDeclaracion?.toLowerCase() || '';
        const isMora = est.includes('mora') || est.includes('pendiente') || est.includes('deuda');
        return (
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
            isMora ? 'bg-rose-50 text-rose-600 border border-rose-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
          }`}>
            {row.EstadoDeclaracion || 'S/D'}
          </span>
        );
      }
    },
    { 
      header: 'Saldo', 
      cell: (row) => (
        <span className={`font-bold ${row.Saldo > 0 ? 'text-rose-500' : 'text-slate-600'}`}>
          $ {Number(row.Saldo || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      )
    },
    { 
      header: 'Contacto', 
      cell: (row) => (
        <div className="flex flex-col max-w-[200px] truncate">
          <span className="text-xs">{row.CorreoEMAS || '—'}</span>
          <span className="text-[10px] text-slate-400">{row.TelefonoEMAS || '—'}</span>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header & Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Padrón de Contribuyentes</h2>
          <p className="text-slate-500 text-sm mt-1">Gestión y consulta de datos maestros del impuesto 1.5%.</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm">
            <Download className="w-4 h-4" />
            Exportar Excel
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/20">
            <UserPlus className="w-4 h-4" />
            Nuevo Registro
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[300px] relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
          <input 
            type="text" 
            placeholder="Buscar por Nombre, RUC, Representante o Dirección..." 
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
          />
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select 
              value={estado}
              onChange={(e) => { setEstado(e.target.value); setPage(1); }}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600 focus:outline-none focus:border-blue-500"
            >
              <option value="">Todos los Estados</option>
              <option value="Declarado">Declarado</option>
              <option value="Pendiente">Pendiente</option>
              <option value="Mora">En Mora</option>
            </select>
          </div>

          <select 
            value={zona}
            onChange={(e) => { setZona(e.target.value); setPage(1); }}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600 focus:outline-none focus:border-blue-500"
          >
            <option value="">Tipo Persona</option>
            <option value="NATURAL">Natural</option>
            <option value="JURIDICA">Jurídica</option>
          </select>
        </div>
      </div>

      {/* Main Table */}
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
