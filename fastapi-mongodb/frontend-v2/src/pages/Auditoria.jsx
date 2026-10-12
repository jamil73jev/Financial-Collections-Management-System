import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, History, User, Activity, Clock, Search } from 'lucide-react';
import api from '../services/api';
import { Table } from '../components/common/Table';

export default function Auditoria() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [tipo, setTipo] = useState('');

  const fetchAuditoria = useCallback(async () => {
    setLoading(true);
    try {
      const skip = (page - 1) * limit;
      const response = await api.get('/api/auditoria', {
        params: { skip, limit, tipo }
      });
      setData(response.data.data);
      setTotal(response.data.total);
    } catch (err) {
      console.error('Error fetching auditoria:', err);
    } finally {
      setLoading(false);
    }
  }, [page, limit, tipo]);

  useEffect(() => {
    fetchAuditoria();
  }, [fetchAuditoria]);

  const columns = [
    { 
      header: 'Fecha / Hora', 
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs font-medium">{new Date(row.fecha).toLocaleString()}</span>
        </div>
      )
    },
    { 
      header: 'Usuario', 
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center">
            <User className="w-3 h-3 text-slate-400" />
          </div>
          <span className="text-xs font-bold text-slate-700">{row.usuario}</span>
        </div>
      )
    },
    { 
      header: 'Acción', 
      cell: (row) => (
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
          row.tipo === 'LOGIN' ? 'bg-blue-50 text-blue-600' : 
          row.tipo === 'CREACION' ? 'bg-emerald-50 text-emerald-600' :
          row.tipo === 'ACTUALIZACION' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'
        }`}>
          {row.tipo}
        </span>
      )
    },
    { 
      header: 'Entidad', 
      cell: (row) => (
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-slate-600 uppercase">{row.entidad}</span>
          <span className="text-[10px] text-slate-400 font-mono">{row.entidadId}</span>
        </div>
      )
    },
    { 
      header: 'Detalle', 
      cell: (row) => (
        <p className="text-xs text-slate-500 max-w-[400px] truncate" title={JSON.stringify(row.meta)}>
          {typeof row.meta === 'string' ? row.meta : JSON.stringify(row.meta).substring(0, 100)}
        </p>
      )
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="text-blue-600 w-7 h-7" />
            Registro de Auditoría
          </h2>
          <p className="text-slate-500 text-sm mt-1">Bitácora de seguridad y trazabilidad de acciones en el sistema.</p>
        </div>
        <div className="bg-slate-100 px-4 py-2 rounded-xl flex items-center gap-3">
          <Activity className="text-slate-400 w-5 h-5" />
          <div className="leading-tight">
            <p className="text-[10px] text-slate-400 font-bold uppercase">Total Eventos</p>
            <p className="text-sm font-black text-slate-700">{total.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-slate-400" />
          <select 
            value={tipo}
            onChange={(e) => { setTipo(e.target.value); setPage(1); }}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600 focus:outline-none focus:border-blue-500"
          >
            <option value="">Todos los Tipos de Eventos</option>
            <option value="LOGIN">Inicio de Sesión</option>
            <option value="CREACION">Creación</option>
            <option value="ACTUALIZACION">Actualización</option>
            <option value="ELIMINACION">Eliminación</option>
          </select>
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
