import { Map as MapIcon, Info, Layers, MapPin, ZoomIn, ZoomOut } from 'lucide-react';
import { useState } from 'react';

const SECTORES = [
  { id: 1, name: 'Centro / 9 de Octubre', x: 45, y: 50, debt: '$ 4.2M', level: 'high' },
  { id: 2, name: 'Samborondón', x: 65, y: 30, debt: '$ 1.8M', level: 'low' },
  { id: 3, name: 'Urdesa / Ceibos', x: 35, y: 35, debt: '$ 2.5M', level: 'medium' },
  { id: 4, name: 'Sur / Centenario', x: 42, y: 70, debt: '$ 3.9M', level: 'high' },
  { id: 5, name: 'Pradera / Fertisa', x: 55, y: 85, debt: '$ 1.2M', level: 'low' },
  { id: 6, name: 'Tarqui / Alborada', x: 38, y: 15, debt: '$ 5.1M', level: 'critical' },
];

const COLORS = {
  low: 'fill-emerald-400 stroke-emerald-600 shadow-emerald-500/20',
  medium: 'fill-amber-400 stroke-amber-600 shadow-amber-500/20',
  high: 'fill-orange-400 stroke-orange-600 shadow-orange-500/20',
  critical: 'fill-rose-500 stroke-rose-700 shadow-rose-600/30',
};

export default function Mapa() {
  const [selected, setSelected] = useState(null);

  return (
    <div className="space-y-6 h-[calc(100vh-140px)] flex flex-col animate-in fade-in duration-700">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <MapIcon className="text-blue-600 w-7 h-7" />
            Mapa de Concentración de Deuda
          </h2>
          <p className="text-slate-500 text-sm mt-1">Visualización por sectores municipales y niveles de morosidad.</p>
        </div>
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden">
        {/* Map Container */}
        <div className="flex-1 bg-slate-900 rounded-3xl border border-slate-800 shadow-2xl relative overflow-hidden group">
          {/* Grid Background Effect */}
          <div className="absolute inset-0 opacity-10 pointer-events-none" 
               style={{ backgroundImage: 'radial-gradient(#475569 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>
          
          {/* Fake Map SVG */}
          <svg viewBox="0 0 100 100" className="w-full h-full opacity-40">
            <path 
              d="M30 10 L70 15 L85 40 L80 80 L50 90 L20 75 Z" 
              fill="none" 
              stroke="#475569" 
              strokeWidth="0.5" 
              strokeDasharray="2 2"
            />
          </svg>

          {/* Map Pins / Points */}
          {SECTORES.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected(s)}
              className="absolute transition-all duration-300 transform -translate-x-1/2 -translate-y-1/2 group/pin"
              style={{ left: `${s.x}%`, top: `${s.y}%` }}
            >
              <div className={`peer relative z-10 w-4 h-4 rounded-full border-2 ${COLORS[s.level]} flex items-center justify-center transition-transform hover:scale-150 cursor-pointer shadow-lg`}>
                <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
              </div>
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full mb-3 opacity-0 group-hover/pin:opacity-100 transition-opacity bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-20 pointer-events-none border border-slate-700">
                {s.name}
              </div>
              {/* Pulse effect for high debt */}
              {s.level === 'critical' && (
                <div className="absolute -inset-2 bg-rose-500/20 rounded-full animate-ping pointer-events-none"></div>
              )}
            </button>
          ))}

          {/* Legend Overlay */}
          <div className="absolute bottom-6 left-6 bg-slate-950/80 backdrop-blur-md border border-slate-800 p-4 rounded-2xl shadow-2xl">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Niveles de Deuda</p>
            <div className="space-y-2">
              {[
                { label: 'Bajo (< $2M)', color: 'bg-emerald-400' },
                { label: 'Medio ($2M - $4M)', color: 'bg-amber-400' },
                { label: 'Alto ($4M - $10M)', color: 'bg-orange-400' },
                { label: 'Crítico (> $10M)', color: 'bg-rose-500' },
              ].map((l) => (
                <div key={l.label} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${l.color}`}></div>
                  <span className="text-[11px] text-slate-400 font-medium">{l.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="absolute top-6 right-6 flex flex-col gap-2">
            <button className="p-3 bg-slate-950/80 backdrop-blur-md border border-slate-800 text-slate-400 hover:text-white rounded-xl shadow-xl transition-colors">
              <ZoomIn className="w-5 h-5" />
            </button>
            <button className="p-3 bg-slate-950/80 backdrop-blur-md border border-slate-800 text-slate-400 hover:text-white rounded-xl shadow-xl transition-colors">
              <ZoomOut className="w-5 h-5" />
            </button>
            <button className="p-3 bg-slate-950/80 backdrop-blur-md border border-slate-800 text-slate-400 hover:text-white rounded-xl shadow-xl transition-colors">
              <Layers className="w-5 h-5" />
            </button>
          </div>

          {/* Info Badge */}
          <div className="absolute top-6 left-6 flex items-center gap-3 px-4 py-2 bg-blue-600/20 border border-blue-500/30 rounded-full backdrop-blur-sm">
            <MapPin className="text-blue-400 w-4 h-4" />
            <span className="text-xs font-bold text-blue-100 uppercase tracking-wider">Cantón Guayaquil</span>
          </div>
        </div>

        {/* Sidebar Info */}
        <div className="w-80 flex flex-col gap-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex-1 overflow-y-auto">
            <h4 className="font-bold text-slate-900 border-b border-slate-100 pb-4 mb-4">Sectores Críticos</h4>
            <div className="space-y-4">
              {SECTORES.sort((a,b) => b.id - a.id).map((s) => (
                <div 
                  key={s.id} 
                  onClick={() => setSelected(s)}
                  className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                    selected?.id === s.id ? 'bg-blue-50 border-blue-200 ring-2 ring-blue-500/10' : 'bg-slate-50 border-transparent hover:border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-800">{s.name}</span>
                    <span className={`text-[10px] font-black uppercase ${PRIORIDAD_COLORS[s.level] || 'text-slate-500'}`}>{s.level}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">Deuda: <span className="text-slate-900 font-bold">{s.debt}</span></span>
                    <button className="text-blue-600 hover:underline text-[10px] font-bold">Ver detalles</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-blue-600 p-6 rounded-3xl shadow-xl shadow-blue-900/20">
            <div className="flex items-center gap-3 mb-3">
              <Info className="text-blue-200 w-5 h-5" />
              <h5 className="text-white font-bold text-sm">Resumen Regional</h5>
            </div>
            <p className="text-blue-100 text-xs leading-relaxed">
              El 65% de la morosidad se concentra en los sectores del Centro y Norte (Tarqui). Se recomienda priorizar operativos de campo en estas zonas.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const PRIORIDAD_COLORS = {
  low: 'text-emerald-500',
  medium: 'text-amber-500',
  high: 'text-orange-500',
  critical: 'text-rose-600',
};
