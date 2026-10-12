import { useState, useEffect, useCallback } from 'react';
import { Search, Filter, Phone, Mail, FileText, Calendar } from 'lucide-react';
import api from '../services/api';
import { Table } from '../components/common/Table';

export default function Gestiones() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [tipo, setTipo] = useState('');
  const [resultado, setResultado] = useState('');
  const [gestor, setGestor] = useState('');

  const fetchGestiones = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/gestiones/', {
        params: { page, page_size: pageSize, tipo, resultado, gestor }
      });
      setData(response.data.data);
      setTotal(response.data.total);
    } catch (err) {
      console.error('Error fetching gestiones:', err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, tipo, resultado, gestor]);

  useEffect(() => {
    fetchGestiones();
  }, [fetchGestiones]);

  const columns = [
    { 
      header: 'Fecha', 
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs font-medium">
            {row.fechaGestion ? new Date(row.fechaGestion).toLocaleDateString() : 'N/D'}
          </span>
        </div>
      )
    },
    { 
      header: 'Contribuyente', 
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-bold text-slate-800">{row.contribuyente_nombre || 'N/D'}</span>
          <span className="text-[10px] text-slate-400 font-medium">{row.ruc}</span>
        </div>
      )
    },
    { 
      header: 'Tipo', 
      cell: (row) => (
        <div className="flex items-center gap-2">
          {row.tipo === 'TELEFONICA' ? <Phone className="w-3.5 h-3.5 text-blue-500" /> : <Mail className="w-3.5 h-3.5 text-slate-500" />}
          <span className="text-xs font-semibold">{row.tipo}</span>
        </div>
      )
    },
    { 
      header: 'Resultado', 
      cell: (row) => {
        const res = row.resultado?.toLowerCase() || '';
        const isSuccess = res.includes('compromiso') || res.includes('pagado');
        return (
          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${
            isSuccess ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-50 text-slate-500 border border-slate-200'
          }`}>
            {row.resultado}
          </span>
        );
      }
    },
    { header: 'Gestor', accessor: 'gestor' },
    { 
      header: 'Observación', 
      cell: (row) => (
        <p className="text-xs text-slate-500 max-w-[250px] truncate" title={row.observacion}>
          {row.observacion || '—'}
        </p>
      )
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Historial de Gestiones</h2>
        <p className="text-slate-500 text-sm mt-1">Seguimiento de acciones de cobranza realizadas por los agentes.</p>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <select 
            value={tipo}
            onChange={(e) => { setTipo(e.target.value); setPage(1); }}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600 focus:outline-none focus:border-blue-500"
          >
            <option value="">Todos los Tipos</option>
            <option value="TELEFONICA">Telefónica</option>
            <option value="CORREO">Correo</option>
            <option value="VISITA">Visita Campo</option>
          </select>

          <select 
            value={resultado}
            onChange={(e) => { setResultado(e.target.value); setPage(1); }}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600 focus:outline-none focus:border-blue-500"
          >
            <option value="">Todos los Resultados</option>
            <option value="COMPROMISO_PAGO">Compromiso Pago</option>
            <option value="SIN_CONTACTO">Sin Contacto</option>
            <option value="RECHAZO">Rechazo</option>
          </select>

          <input 
            type="text" 
            placeholder="Filtrar por Gestor..." 
            value={gestor}
            onChange={(e) => { setGestor(e.target.value); setPage(1); }}
            className="pl-3 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
          />
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
