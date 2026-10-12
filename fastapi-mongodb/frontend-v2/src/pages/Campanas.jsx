import { useState } from 'react';
import { 
  Megaphone, 
  Search, 
  Filter, 
  ChevronRight, 
  ChevronLeft, 
  CheckCircle2, 
  AlertCircle,
  Users,
  Mail,
  Send,
  Loader2
} from 'lucide-react';
import api from '../services/api';
import { useNavigate } from 'react-router-dom';

const STEPS = [
  { id: 1, name: 'Segmentación', description: 'Define el público objetivo' },
  { id: 2, name: 'Previsualización', description: 'Revisa la audiencia calculada' },
  { id: 3, name: 'Mensaje', description: 'Redacta el contenido formal' },
  { id: 4, name: 'Ejecución', description: 'Lanzamiento de campaña' },
];

export default function Campanas() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  
  const [form, setForm] = useState({
    nombre: '',
    mensaje: '',
    medio: 'email',
    filtro: {
      clasificacion: 'TODOS',
      tipo_persona: '',
      estado_declaracion: ''
    }
  });

  const nextStep = async () => {
    if (step === 1) {
      setLoading(true);
      try {
        const res = await api.post('/api/campanas/preview', form);
        setPreviewData(res.data);
        setStep(2);
      } catch (err) {
        console.error('Error in preview:', err);
      } finally {
        setLoading(false);
      }
    } else {
      setStep(step + 1);
    }
  };

  const executeCampana = async () => {
    setLoading(true);
    try {
      await api.post('/api/campanas/ejecutar', form);
      alert('Campaña ejecutada exitosamente.');
      navigate('/notificaciones');
    } catch (err) {
      console.error('Error executing campaign:', err);
      alert('Error al ejecutar la campaña.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Megaphone className="text-blue-600 w-7 h-7" />
          Nueva Campaña de Notificación
        </h2>
        <p className="text-slate-500 mt-1">Sigue los pasos para realizar una notificación masiva de deuda.</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center justify-between px-4">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-2">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 font-bold ${
                step >= s.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-400'
              }`}>
                {step > s.id ? <CheckCircle2 className="w-6 h-6" /> : s.id}
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-widest ${step >= s.id ? 'text-blue-600' : 'text-slate-400'}`}>
                {s.name}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-[2px] mx-4 -mt-6 transition-all duration-500 ${step > s.id ? 'bg-blue-600' : 'bg-slate-200'}`}></div>
            )}
          </div>
        ))}
      </div>

      {/* Form Content */}
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm min-h-[400px]">
        {step === 1 && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Clasificación de Mora</label>
                <select 
                  value={form.filtro.clasificacion}
                  onChange={(e) => setForm({...form, filtro: {...form.filtro, clasificacion: e.target.value}})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 outline-none"
                >
                  <option value="TODOS">Todos los Morosos</option>
                  <option value="MORA_LEVE">Mora Leve (&lt; 500)</option>
                  <option value="MORA_MEDIA">Mora Media (500 - 2000)</option>
                  <option value="MORA_ALTA">Mora Alta (2000 - 5000)</option>
                  <option value="MORA_CRITICA">Mora Crítica (&gt; 5000)</option>
                  <option value="COACTIVA">Coactiva (&gt; 20000)</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tipo de Contribuyente</label>
                <select 
                  value={form.filtro.tipo_persona}
                  onChange={(e) => setForm({...form, filtro: {...form.filtro, tipo_persona: e.target.value}})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 outline-none"
                >
                  <option value="">Cualquiera</option>
                  <option value="NATURAL">Persona Natural</option>
                  <option value="JURIDICA">Persona Jurídica</option>
                </select>
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-100 p-4 rounded-2xl flex gap-4">
              <AlertCircle className="text-blue-600 w-5 h-5 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-800 leading-relaxed">
                Selecciona los criterios para segmentar a los contribuyentes que recibirán la notificación. El sistema calculará el total en el siguiente paso.
              </p>
            </div>
          </div>
        )}

        {step === 2 && previewData && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center">
                <Users className="w-5 h-5 text-blue-600 mx-auto mb-2" />
                <p className="text-2xl font-black text-slate-900">{previewData.total_contrib}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Total Población</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center">
                <Mail className="w-5 h-5 text-emerald-600 mx-auto mb-2" />
                <p className="text-2xl font-black text-slate-900">{previewData.con_email}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Con Email</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center text-rose-500">
                <AlertCircle className="w-5 h-5 mx-auto mb-2" />
                <p className="text-2xl font-black">{previewData.sin_contacto}</p>
                <p className="text-[10px] font-bold uppercase">Sin Contacto</p>
              </div>
            </div>
            
            <h4 className="font-bold text-sm text-slate-800 mt-6 mb-3">Muestra de Audiencia (Top 5)</h4>
            <div className="border border-slate-100 rounded-2xl overflow-hidden text-xs">
              <table className="w-full">
                <thead className="bg-slate-50 font-bold text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="p-3 text-left">RUC</th>
                    <th className="p-3 text-left">Contribuyente</th>
                    <th className="p-3 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {previewData.muestra_10.slice(0, 5).map((c, i) => (
                    <tr key={i}>
                      <td className="p-3 font-mono">{c.ruc}</td>
                      <td className="p-3 font-medium">{c.nombre}</td>
                      <td className="p-3 text-right font-bold text-rose-600">$ {c.saldo.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nombre de la Campaña</label>
              <input 
                type="text" 
                placeholder="Ej: Notificación 1.5% - Sector Centro - T1 2024" 
                value={form.nombre}
                onChange={(e) => setForm({...form, nombre: e.target.value})}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Mensaje de Notificación</label>
              <textarea 
                rows="6" 
                placeholder="Estimado contribuyente, se le notifica que mantiene una deuda pendiente..." 
                value={form.mensaje}
                onChange={(e) => setForm({...form, mensaje: e.target.value})}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 outline-none resize-none font-sans"
              ></textarea>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col items-center justify-center text-center space-y-6 h-full py-12">
            <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center animate-bounce">
              <Send className="w-10 h-10" />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-900 leading-tight">¿Confirmar Ejecución?</h3>
              <p className="text-slate-500 text-sm mt-2 max-w-sm mx-auto">
                Se enviarán <span className="font-bold text-blue-600">{previewData?.con_email}</span> correos electrónicos de forma inmediata. Esta acción es irreversible y quedará registrada en la auditoría.
              </p>
            </div>
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl text-amber-700 text-xs font-medium max-w-md">
              Asegúrate de haber revisado el contenido del mensaje y el filtro aplicado antes de proceder.
            </div>
          </div>
        )}
      </div>

      {/* Persistence Controls */}
      <div className="flex items-center justify-between">
        <button 
          disabled={step === 1 || loading}
          onClick={() => setStep(step - 1)}
          className="flex items-center gap-2 px-6 py-3 text-slate-600 font-bold hover:bg-slate-100 rounded-2xl transition-all disabled:opacity-0"
        >
          <ChevronLeft className="w-5 h-5" />
          Anterior
        </button>
        
        {step < 4 ? (
          <button 
            disabled={loading}
            onClick={nextStep}
            className="flex items-center gap-2 px-8 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/20 disabled:bg-slate-400"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Continuar'}
            <ChevronRight className="w-5 h-5" />
          </button>
        ) : (
          <button 
            disabled={loading}
            onClick={executeCampana}
            className="flex items-center gap-2 px-10 py-3 bg-emerald-600 text-white font-black rounded-2xl hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-900/20 disabled:scale-95"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'SÍ, EJECUTAR CAMPAÑA'}
            <CheckCircle2 className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}
