import { useState, useEffect, useCallback } from 'react';
import { Search, Filter, Bell, Download, Plus, Eye, CheckCircle, Clock, XCircle, AlertCircle } from 'lucide-react';
import api from '../services/api';
import { Table } from '../components/common/Table';
import { Link } from 'react-router-dom';

const ESTADOS_NOTIF = {
  'pendiente': { color: 'bg-amber-50 text-amber-600 border-amber-100', icon: Clock },
  'enviada':   { color: 'bg-blue-50 text-blue-600 border-blue-100',   icon: Bell },
  'recibida':  { color: 'bg-indigo-50 text-indigo-600 border-indigo-100', icon: CheckCircle },
  'en_gestion':{ color: 'bg-violet-50 text-violet-600 border-violet-100', icon: Clock },
  'cobrada':   { color: 'bg-emerald-50 text-emerald-600 border-emerald-100', icon: CheckCircle },
  'vencida':   { color: 'bg-rose-50 text-rose-600 border-rose-100',   icon: XCircle },
  'anulada':   { color: 'bg-slate-100 text-slate-500 border-slate-200', icon: AlertCircle },
};

export default function Notificaciones() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [search, setSearch] = useState('');
  const [estado, setEstado] = useState('');

  const fetchNotificaciones = useCallback(async () => {
    setLoading(true);
    try {
      const skip = (page - 1) * limit;
      const response = await api.get('/api/notificaciones', {
        params: { skip, limit, search, estado }
      });
      setData(response.data.data);
      setTotal(response.data.total);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, estado]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchNotificaciones();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchNotificaciones]);

  const downloadPdf = async (nid) => {
    try {
      const response = await api.get(`/api/export/notificacion/${nid}.pdf`, {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Notificacion_${nid}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('Error downloading PDF:', err);
      alert('No se pudo descargar el PDF de la notificación.');
    }
  };

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
        <span className="text-xs font-semibold text-slate-700 max-w-[200px] truncate block" title={row.contribuyente}>
          {row.contribuyente || 'N/D'}
        </span>
      )
    },
    { 
      header: 'Deuda / Año', 
      cell: (row) => (
        <div className="flex flex-col">
          <span className="text-xs font-bold text-slate-900">$ {Number(row.montoTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          <span className="text-[10px] text-slate-400">Año: {row.anio || row.ejercicio || '2024'}</span>
        </div>
      )
    },
    { 
      header: 'Estado', 
      cell: (row) => {
        const est = row.estado?.toLowerCase() || 'pendiente';
        const config = ESTADOS_NOTIF[est] || ESTADOS_NOTIF['pendiente'];
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
      header: 'Fecha Emisión', 
      cell: (row) => (
        <span className="text-[11px] text-slate-500">
          {row.fechaCreacion ? new Date(row.fechaCreacion).toLocaleDateString() : 'N/D'}
        </span>
      )
    },
    { 
      header: 'Acciones', 
      cell: (row) => (
        <div className="flex items-center gap-2">
          <button 
            onClick={() => downloadPdf(row._id)}
            className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors"
            title="Descargar PDF"
          >
            <Download className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors" title="Ver Gestión">
            <Eye className="w-4 h-4" />
          </button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Gestión de Notificaciones</h2>
          <p className="text-slate-500 text-sm mt-1">Monitoreo y seguimiento de actos administrativos de notificación de deuda.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link 
            to="/campanas"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/20"
          >
            <Plus className="w-4 h-4" />
            Nueva Campaña
          </Link>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[300px] relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
          <input 
            type="text" 
            placeholder="Buscar por RUC o Contribuyente..." 
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
          />
        </div>
        
        <div className="flex items-center gap-3">
          <select 
            value={estado}
            onChange={(e) => { setEstado(e.target.value); setPage(1); }}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600 focus:outline-none focus:border-blue-500"
          >
            <option value="">Cualquier Estado</option>
            {Object.keys(ESTADOS_NOTIF).map(e => (
              <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
            ))}
          </select>
          <div className="h-8 w-[1px] bg-slate-200 mx-2"></div>
          <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
            <Filter className="w-5 h-5" />
          </button>
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
