import { useState, useEffect } from 'react';
import { 
  User, 
  Shield, 
  Mail, 
  Key, 
  Clock, 
  Save, 
  AlertCircle, 
  CheckCircle2,
  Loader2,
  Activity
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { motion, AnimatePresence } from 'framer-motion';

export default function Perfil() {
  const { user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [loadingPass, setLoadingPass] = useState(false);
  const { showToast } = useToast();
  const [passForm, setPassForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  useEffect(() => {
    const fetchMyLogs = async () => {
      if (!user) return;
      try {
        const res = await api.get('/api/auditoria', {
          params: { usuario: user.username, limit: 10 }
        });
        setLogs(res.data.data);
      } catch (err) {
        showToast('Error al cargar la bitácora de actividad', 'error');
      } finally {
        setLoadingLogs(false);
      }
    };
    fetchMyLogs();
  }, [user, showToast]);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passForm.newPassword !== passForm.confirmPassword) {
      showToast('Las contraseñas no coinciden.', 'warning');
      return;
    }
    
    setLoadingPass(true);
    try {
      await api.put(`/api/auth/usuarios/${user._id}/password`, {
        password: passForm.newPassword
      });
      showToast('Contraseña actualizada correctamente.', 'success');
      setPassForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error al cambiar contraseña.', 'error');
    } finally {
      setLoadingPass(false);
    }
  };

  if (!user) return null;

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-700">
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center text-white text-3xl font-black shadow-xl shadow-blue-500/20">
          {user.username.substring(0, 2).toUpperCase()}
        </div>
        <div>
          <h2 className="text-3xl font-black text-slate-900">{user.nombre}</h2>
          <p className="text-slate-500 font-medium flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-500" />
            {user.role} — <span className="text-slate-400">@{user.username}</span>
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Left Column: Info & Password */}
        <div className="lg:col-span-2 space-y-8">
          <section className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
              <User className="w-4 h-4 text-blue-600" />
              Información Personal
            </h3>
            
            <div className="grid sm:grid-cols-2 gap-6">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nombre Completo</span>
                <p className="text-sm font-semibold text-slate-700 p-3 bg-slate-50 rounded-xl border border-slate-100">{user.nombre}</p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Correo Institucional</span>
                <p className="text-sm font-semibold text-slate-700 p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-slate-400" />
                  {user.email || 'No registrado'}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cargo / Departamento</span>
                <p className="text-sm font-semibold text-slate-700 p-3 bg-slate-50 rounded-xl border border-slate-100 capitalize">{user.cargo || 'Funcionario Municipal'}</p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Estado de Cuenta</span>
                <p className="text-sm font-bold text-emerald-600 p-3 bg-emerald-50 rounded-xl border border-emerald-100 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Activa
                </p>
              </div>
            </div>
          </section>

          <section className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
              <Key className="w-4 h-4 text-amber-500" />
              Seguridad y Contraseña
            </h3>

            <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Nueva Contraseña</label>
                <input 
                  type="password"
                  required
                  value={passForm.newPassword}
                  onChange={(e) => setPassForm({...passForm, newPassword: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-blue-500 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Confirmar Nueva Contraseña</label>
                <input 
                  type="password"
                  required
                  value={passForm.confirmPassword}
                  onChange={(e) => setPassForm({...passForm, confirmPassword: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-blue-500 outline-none"
                />
              </div>



              <button 
                type="submit"
                disabled={loadingPass}
                className="w-full py-3 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all disabled:bg-slate-400 shadow-lg shadow-slate-900/10"
              >
                {loadingPass ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-4 h-4" />}
                Actualizar Credenciales
              </button>
            </form>
          </section>
        </div>

        {/* Right Column: Activity History */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-2 flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Actividad Reciente
          </h3>
          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
            {loadingLogs ? (
              <div className="p-12 flex flex-col items-center justify-center gap-4 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin" />
                <p className="text-xs font-medium">Cargando bitácora...</p>
              </div>
            ) : logs.length > 0 ? (
              <div className="divide-y divide-slate-50">
                {logs.map((log, i) => (
                  <div key={i} className="p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-black text-blue-600 uppercase italic">[{log.tipo}]</span>
                      <span className="text-[9px] text-slate-400 font-medium flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(log.fecha).toLocaleDateString()} {new Date(log.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      {log.detalle}
                    </p>
                    <p className="text-[9px] text-slate-400 mt-1 uppercase font-bold tracking-tighter">ID: {log.entidadId}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center text-slate-400">
                <Activity className="w-8 h-8 mx-auto mb-3 opacity-20" />
                <p className="text-xs font-medium">No hay actividad reciente registrada.</p>
              </div>
            )}
          </div>
          <button className="w-full py-3 text-[10px] font-bold text-slate-400 hover:text-blue-500 transition-colors uppercase tracking-widest">
            Ver auditoría completa
          </button>
        </div>
      </div>
    </div>
  );
}
