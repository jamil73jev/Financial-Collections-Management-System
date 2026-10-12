import { Link, useLocation } from 'react-router-dom';
import { 
  BarChart3, 
  Users, 
  FileText, 
  CreditCard, 
  AlertTriangle, 
  ShieldCheck, 
  Map as MapIcon,
  Settings,
  LogOut,
  ChevronRight,
  Bell,
  Database,
  User
} from 'lucide-react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useAuth } from '../../context/AuthContext';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export const Sidebar = ({ onLogout }) => {
  const location = useLocation();
  const { user } = useAuth();

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3, path: '/' },
    { id: 'contribuyentes', label: 'Contribuyentes', icon: Users, path: '/contribuyentes' },
    { id: 'gestiones', label: 'Gestiones', icon: FileText, path: '/gestiones' },
    { id: 'convenios', label: 'Convenios', icon: CreditCard, path: '/convenios' },
    { id: 'divider', isDivider: true },
    { id: 'morosidad', label: 'Análisis Morosidad', icon: AlertTriangle, path: '/morosidad' },
    { id: 'notificaciones', label: 'Notificaciones', icon: Bell, path: '/notificaciones' },
    { id: 'auditoria', label: 'Auditoría', icon: ShieldCheck, path: '/auditoria' },
    { id: 'mapa', label: 'Mapa de Deuda', icon: MapIcon, path: '/mapa' },
    { id: 'centro_datos', label: 'Centro de Datos', icon: Database, path: '/centro-datos', roles: ['ADMINISTRADOR', 'SUPERVISOR'] },
    { id: 'usuarios', label: 'Usuarios', icon: User, path: '/usuarios', roles: ['ADMINISTRADOR'] },
    { id: 'perfil', label: 'Mi Perfil', icon: Settings, path: '/perfil' },
  ];

  const filteredItems = menuItems.filter(item => {
    if (!item.roles) return true;
    return user && item.roles.includes(user.role);
  });

  return (
    <aside className="w-64 h-screen bg-slate-900 text-slate-300 flex flex-col fixed left-0 top-0 border-r border-slate-800 shadow-xl overflow-hidden">
      {/* Brand */}
      <div className="p-6 flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/40">
          <ShieldCheck className="text-white w-6 h-6" />
        </div>
        <div>
          <h1 className="text-white font-bold text-xl tracking-tight">SIGECO</h1>
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-widest">v2.0 Beta</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-4 space-y-1">
        {filteredItems.map((item) => {
          if (item.isDivider) {
            return <div key={item.id} className="my-6 border-t border-slate-800 mx-2" />;
          }

          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          return (
            <Link
              key={item.id}
              to={item.path}
              className={cn(
                "group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                isActive 
                  ? "bg-blue-600/10 text-blue-400 font-medium" 
                  : "hover:bg-slate-800 hover:text-white"
              )}
            >
              <Icon className={cn(
                "w-5 h-5 transition-colors duration-200",
                isActive ? "text-blue-500" : "text-slate-500 group-hover:text-blue-400"
              )} />
              <span className="flex-1">{item.label}</span>
              {isActive && (
                <motion.div 
                  layoutId="active-indicator"
                  className="w-1 h-5 bg-blue-500 rounded-full"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 bg-slate-950/40 border-t border-slate-800">
        <button 
          onClick={onLogout}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Cerrar Sesión</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
