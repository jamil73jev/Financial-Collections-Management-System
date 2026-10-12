import { useState } from 'react';
import { 
  Database, 
  Upload, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  ArrowRight,
  ShieldAlert,
  Loader2,
  Trash2
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import { motion, AnimatePresence } from 'framer-motion';

const DATA_TYPES = [
  { id: 'contribuyentes', name: 'Contribuyentes', desc: 'Actualización masiva del padrón', icon: FileSpreadsheet, color: 'text-blue-600', bg: 'bg-blue-50' },
  { id: 'pagos', name: 'Pagos Externos', desc: 'Carga de recaudación bancaria', icon: Database, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { id: 'vencimientos', name: 'Calendario Fiscal', desc: 'Fechas límite por impuesto', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
];

export default function CentroDatos() {
  const [selectedType, setSelectedType] = useState(null);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const { showToast } = useToast();

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handlePreview = async () => {
    if (!file || !selectedType) return;
    setLoading(true);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('tipo', selectedType.id);

    try {
      const res = await api.post('/api/admin/importar/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setPreview(res.data);
      showToast('Previsualización generada correctamente', 'info');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error al procesar el archivo.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setLoading(true);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('tipo', selectedType.id);

    try {
      const res = await api.post('/api/admin/importar/confirmar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setResult(res.data);
      setPreview(null);
      setFile(null);
      showToast('¡Importación masiva exitosa!', 'success');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error al importar los datos.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Database className="text-indigo-600 w-7 h-7" />
          Centro de Datos & Importación
        </h2>
        <p className="text-slate-500 mt-1">Gestión masiva de la información del sistema SIGECO.</p>
      </div>

      {!result ? (
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Step 1: Select Type */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-2">1. Tipo de Datos</h3>
            <div className="space-y-3">
              {DATA_TYPES.map((type) => (
                <button
                  key={type.id}
                  onClick={() => { setSelectedType(type); setPreview(null); setError(null); }}
                  className={`w-full p-4 rounded-2xl border transition-all text-left flex items-start gap-4 ${
                    selectedType?.id === type.id 
                      ? 'bg-white border-blue-500 shadow-md shadow-blue-500/10' 
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className={`p-2.5 rounded-xl ${type.bg} ${type.color}`}>
                    <type.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">{type.name}</h4>
                    <p className="text-xs text-slate-500 mt-0.5">{type.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Upload File */}
          <div className="lg:col-span-2 space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-2">2. Carga de Archivo</h3>
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-12 flex flex-col items-center justify-center text-center space-y-4 transition-colors hover:border-blue-400 group">
              {file ? (
                <div className="flex flex-col items-center">
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4">
                    <FileSpreadsheet className="w-8 h-8" />
                  </div>
                  <p className="font-bold text-slate-900">{file.name}</p>
                  <p className="text-xs text-slate-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                  <button 
                    onClick={() => {setFile(null); setPreview(null);}}
                    className="mt-4 flex items-center gap-2 text-xs font-bold text-rose-500 hover:text-rose-600"
                  >
                    <Trash2 className="w-4 h-4" /> Eliminar archivo
                  </button>
                </div>
              ) : (
                <>
                  <div className="w-16 h-16 bg-slate-50 text-slate-400 rounded-2xl flex items-center justify-center group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors">
                    <Upload className="w-8 h-8" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">Haz clic para buscar o arrastra un archivo</p>
                    <p className="text-xs text-slate-500 mt-1">Formatos soportados: .xlsx, .xls, .csv</p>
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    id="file-upload"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileChange}
                  />
                  <label
                    htmlFor="file-upload"
                    className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold cursor-pointer hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20"
                  >
                    Seleccionar Archivo
                  </label>
                </>
              )}
            </div>

            <AnimatePresence mode="wait">
              {file && selectedType && !preview && (
                <motion.button
                  key="btn-preview"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  onClick={handlePreview}
                  disabled={loading}
                  className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all disabled:bg-slate-400"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Siguiente: Previsualizar Datos'}
                  <ArrowRight className="w-4 h-4" />
                </motion.button>
              )}
            </AnimatePresence>

            {preview && (
              <div className="space-y-4 animate-in slide-in-from-top-4 duration-500">
                <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex gap-3 text-amber-800 italic">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p className="text-xs font-medium">Muestra de las primeras 5 filas detectadas. Revisa que las columnas coincidan.</p>
                </div>
                
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                        <tr>
                          {preview.data.length > 0 && Object.keys(preview.data[0]).map(k => (
                            <th key={k} className="px-4 py-3">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {preview.data.map((row, i) => (
                          <tr key={i}>
                            {Object.values(row).map((v, j) => (
                              <td key={j} className="px-4 py-3 text-slate-600">{String(v || '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button
                    onClick={() => setPreview(null)}
                    className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleConfirm}
                    disabled={loading}
                    className="flex-[2] py-4 bg-emerald-600 text-white rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-500/20"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'CONFIAR E IMPORTAR TODO'}
                    <CheckCircle2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-6 max-w-2xl mx-auto shadow-xl animate-in zoom-in duration-500">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-12 h-12" />
          </div>
          <div>
            <h3 className="text-2xl font-black text-slate-900">¡Importación Completada!</h3>
            <p className="text-slate-500 mt-2">Los datos se han procesado correctamente y ya están disponibles en el sistema.</p>
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-left">
            <div className="bg-slate-50 p-4 rounded-2xl">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Procesadas</p>
              <p className="text-xl font-bold text-slate-900">{result.filas_procesadas}</p>
            </div>
            <div className="bg-emerald-50 p-4 rounded-2xl">
              <p className="text-[10px] font-bold text-emerald-600 uppercase">Insertadas/Actualizadas</p>
              <p className="text-xl font-bold text-emerald-700">{result.insertados || result.actualizados || 0}</p>
            </div>
          </div>

          <button
            onClick={() => setResult(null)}
            className="w-full py-4 text-blue-600 font-bold hover:bg-blue-50 rounded-2xl transition-all"
          >
            Realizar otra importación
          </button>
        </div>
      )}
    </div>
  );
}
