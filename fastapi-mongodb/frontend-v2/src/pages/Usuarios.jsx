import { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  Shield, 
  Mail, 
  CheckCircle2, 
  XCircle,
  MoreVertical,
  Edit2,
  Key,
  Trash2,
  Loader2
} from 'lucide-react';
import api from '../services/api';
import { Table } from '../components/common/Table';

import { useToast } from '../context/ToastContext';
import { motion, AnimatePresence } from 'framer-motion';

const ROLES = ['ADMINISTRADOR', 'SUPERVISOR', 'GESTOR', 'AUDITOR'];

export default function Usuarios() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const { showToast } = useToast();
  
  const [form, setForm] = useState({
    username: '',
    nombre: '',
    email: '',
    cargo: '',
    role: 'GESTOR',
    password: ''
  });

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/auth/usuarios');
      setData(res.data.data);
    } catch (err) {
      showToast('Error al cargar la lista de usuarios', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editingUser) {
        await api.put(`/api/auth/usuarios/${editingUser._id}`, form);
        showToast('Usuario actualizado correctamente', 'success');
      } else {
        await api.post('/api/auth/usuarios', form);
        showToast('Nuevo usuario creado exitosamente', 'success');
      }
      setShowModal(false);
      setEditingUser(null);
      fetchUsers();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error al guardar el usuario', 'error');
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    { 
      header: 'Usuario', 
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs uppercase">
            {row.username.substring(0, 2)}
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-slate-900">{row.nombre}</span>
            <span className="text-[10px] text-slate-400 font-mono">@{row.username}</span>
          </div>
        </div>
      )
    },
    { 
      header: 'Rol', 
      cell: (row) => (
        <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black border ${
          row.role === 'ADMINISTRADOR' ? 'bg-amber-50 text-amber-600 border-amber-100' :
          row.role === 'SUPERVISOR' ? 'bg-blue-50 text-blue-600 border-blue-100' :
          'bg-slate-50 text-slate-500 border-slate-100'
        }`}>
          <Shield className="w-3 h-3" />
          {row.role}
        </div>
      )
    },
    { 
      header: 'Contacto', 
      cell: (row) => (
        <div className="flex flex-col">
          <span className="text-xs text-slate-600">{row.email || 'S/E'}</span>
          <span className="text-[10px] text-slate-400 capitalize">{row.cargo || 'Funcionario'}</span>
        </div>
      )
    },
    { 
      header: 'Estado', 
      cell: (row) => (
        <div className={`flex items-center gap-1.5 font-bold text-[10px] ${row.activo ? 'text-emerald-500' : 'text-slate-400'}`}>
          {row.activo ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
          {row.activo ? 'ACTIVO' : 'INACTIVO'}
        </div>
      )
    },
    { 
      header: 'Último Acceso', 
      cell: (row) => (
        <span className="text-[11px] text-slate-400">
          {row.ultimoAcceso ? new Date(row.ultimoAcceso).toLocaleString() : 'Nunca'}
        </span>
      )
    },
    { 
      header: 'Acciones', 
      cell: (row) => (
        <div className="flex items-center gap-1">
          <button 
            onClick={() => {
              setEditingUser(row);
              setForm({
                username: row.username,
                nombre: row.nombre,
                email: row.email || '',
                cargo: row.cargo || '',
                role: row.role,
                password: ''
              });
              setShowModal(true);
            }}
            className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors">
            <Key className="w-4 h-4" />
          </button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-700">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Users className="text-blue-600 w-7 h-7" />
            Control de Usuarios
          </h2>
          <p className="text-slate-500 mt-1">Administración de accesos y roles institucionales.</p>
        </div>
        <button 
          onClick={() => {
            setEditingUser(null);
            setForm({ username: '', nombre: '', email: '', cargo: '', role: 'GESTOR', password: '' });
            setShowModal(true);
          }}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20"
        >
          <UserPlus className="w-4 h-4" />
          Nuevo Usuario
        </button>
      </div>

      <div className="min-h-[500px]">
        <Table 
          columns={columns}
          data={data}
          loading={loading}
        />
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-slate-200 animate-in zoom-in duration-300">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-slate-900">{editingUser ? 'Editar Usuario' : 'Crear Nuevo Usuario'}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Username</label>
                  <input 
                    type="text" 
                    disabled={!!editingUser}
                    required
                    value={form.username}
                    onChange={(e) => setForm({...form, username: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:border-blue-500 outline-none disabled:opacity-50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Rol</label>
                  <select 
                    value={form.role}
                    onChange={(e) => setForm({...form, role: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-blue-500 outline-none"
                  >
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Nombre Completo</label>
                <input 
                  type="text" 
                  required
                  value={form.nombre}
                  onChange={(e) => setForm({...form, nombre: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:border-blue-500 outline-none"
                />
              </div>

              {!editingUser && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Contraseña Inicial</label>
                  <input 
                    type="password" 
                    required
                    value={form.password}
                    onChange={(e) => setForm({...form, password: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:border-blue-500 outline-none"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">E-mail</label>
                <input 
                  type="email" 
                  value={form.email}
                  onChange={(e) => setForm({...form, email: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:border-blue-500 outline-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-2xl transition-all"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={loading}
                  className="flex-[2] py-3 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20 disabled:bg-slate-400"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (editingUser ? 'ACTUALIZAR' : 'CREAR USUARIO')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
