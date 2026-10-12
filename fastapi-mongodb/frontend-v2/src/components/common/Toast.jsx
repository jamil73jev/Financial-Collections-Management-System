import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, X, Info, ShieldAlert } from 'lucide-react';

const icons = {
  success: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
  error: <ShieldAlert className="w-5 h-5 text-rose-500" />,
  warning: <AlertCircle className="w-5 h-5 text-amber-500" />,
  info: <Info className="w-5 h-5 text-blue-500" />,
};

const colors = {
  success: 'bg-emerald-50 border-emerald-100 shadow-emerald-500/10',
  error: 'bg-rose-50 border-rose-100 shadow-rose-500/10',
  warning: 'bg-amber-50 border-amber-100 shadow-amber-500/10',
  info: 'bg-blue-50 border-blue-100 shadow-blue-500/10',
};

export const Toast = ({ id, message, type = 'info', onRemove }) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 50, scale: 0.8 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 20, scale: 0.8, transition: { duration: 0.2 } }}
      className={`flex items-start gap-4 p-4 rounded-2xl border ${colors[type]} shadow-xl w-80 pointer-events-auto overflow-hidden`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {icons[type]}
      </div>
      <div className="flex-1">
        <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-0.5">{type}</p>
        <p className="text-sm font-bold text-slate-900 leading-tight">{message}</p>
      </div>
      <button 
        onClick={() => onRemove(id)}
        className="flex-shrink-0 p-1 text-slate-400 hover:text-slate-600 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      
      {/* Progress bar indicator */}
      <motion.div 
        initial={{ width: '100%' }}
        animate={{ width: '0%' }}
        transition={{ duration: 4, ease: 'linear' }}
        className={`absolute bottom-0 left-0 h-1 ${
          type === 'success' ? 'bg-emerald-500' :
          type === 'error' ? 'bg-rose-500' :
          type === 'warning' ? 'bg-amber-500' : 'bg-blue-500'
        }`}
      />
    </motion.div>
  );
};

export const ToastContainer = ({ toasts, removeToast }) => {
  return (
    <div className="fixed top-8 right-8 z-[100] flex flex-col gap-3 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} onRemove={removeToast} />
        ))}
      </AnimatePresence>
    </div>
  );
};
