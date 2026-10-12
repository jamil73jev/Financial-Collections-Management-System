import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { Skeleton } from './Skeleton';

export const Table = ({ 
  columns, 
  data, 
  loading, 
  pagination, 
  onPageChange,
  emptyMessage = "No se encontraron registros."
}) => {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-x-auto border border-slate-200 rounded-t-2xl bg-white">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {columns.map((col, idx) => (
                <th key={idx} className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {col.header}
                </th>
              ))}
              <th className="px-6 py-4 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}>
                  {columns.map((_, j) => (
                    <td key={j} className="px-6 py-4">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                  <td className="px-6 py-4 text-right">
                    <Skeleton className="h-4 w-4 rounded-full ml-auto" />
                  </td>
                </tr>
              ))
            ) : data.length > 0 ? (
              data.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50 transition-colors group">
                  {columns.map((col, j) => (
                    <td key={j} className="px-6 py-4 text-sm text-slate-600">
                      {col.cell ? col.cell(row) : row[col.accessor]}
                    </td>
                  ))}
                  <td className="px-6 py-4 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors">
                      <MoreHorizontal className="w-4 h-4 text-slate-500" />
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length + 1} className="px-6 py-12 text-center text-slate-400">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {pagination && (
        <div className="px-6 py-4 bg-white border-x border-b border-slate-200 rounded-b-2xl flex items-center justify-between shadow-sm">
          <p className="text-xs text-slate-500 font-medium whitespace-nowrap">
            Mostrando <span className="text-slate-900">{pagination.current_rows}</span> de <span className="text-slate-900">{pagination.total.toLocaleString()}</span> registros
          </p>
          <div className="flex items-center gap-2">
            <button 
              disabled={pagination.page <= 1 || loading}
              onClick={() => onPageChange(pagination.page - 1)}
              className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
            >
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </button>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200 shadow-sm">
                {pagination.page}
              </span>
              <span className="text-xs text-slate-400 font-medium">de</span>
              <span className="text-xs font-bold text-slate-500">
                {Math.ceil(pagination.total / pagination.limit)}
              </span>
            </div>
            <button 
              disabled={pagination.page >= Math.ceil(pagination.total / pagination.limit) || loading}
              onClick={() => onPageChange(pagination.page + 1)}
              className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
            >
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
