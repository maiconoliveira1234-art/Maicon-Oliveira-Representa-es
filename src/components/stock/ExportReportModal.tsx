import React, { useState, useEffect } from 'react';
import { X, Share2, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export type StockReportColumnId = 
  | 'produto' 
  | 'ult_contagem' 
  | 'ult_pedido' 
  | 'ult_estoque' 
  | 'contagem_atual' 
  | 'venda';

export interface StockReportColumnOption {
  id: StockReportColumnId;
  label: string;
  defaultSelected: boolean;
}

export const STOCK_REPORT_COLUMNS: StockReportColumnOption[] = [
  { id: 'produto', label: 'Produto', defaultSelected: true },
  { id: 'ult_contagem', label: 'Ult Contagem', defaultSelected: false },
  { id: 'ult_pedido', label: 'Ult pedido', defaultSelected: false },
  { id: 'ult_estoque', label: 'Ult Estoque', defaultSelected: false },
  { id: 'contagem_atual', label: 'Contagem Atual', defaultSelected: true },
  { id: 'venda', label: 'Venda', defaultSelected: false },
];

export const DEFAULT_SELECTED_COLUMNS: StockReportColumnId[] = STOCK_REPORT_COLUMNS
  .filter(col => col.defaultSelected)
  .map(col => col.id);

interface ExportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selectedColumns: StockReportColumnId[]) => void;
  isGenerating?: boolean;
}

export function ExportReportModal({
  isOpen,
  onClose,
  onConfirm,
  isGenerating = false
}: ExportReportModalProps) {
  const [selectedCols, setSelectedCols] = useState<StockReportColumnId[]>(DEFAULT_SELECTED_COLUMNS);

  // Reset to strict defaults whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedCols(DEFAULT_SELECTED_COLUMNS);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleColumn = (id: StockReportColumnId) => {
    setSelectedCols(prev => {
      if (prev.includes(id)) {
        return prev.filter(colId => colId !== id);
      } else {
        // Keep strictly the defined order (1 to 6)
        const newSelection = [...prev, id];
        return STOCK_REPORT_COLUMNS
          .filter(col => newSelection.includes(col.id))
          .map(col => col.id);
      }
    });
  };

  const handleSelectAll = () => {
    if (selectedCols.length === STOCK_REPORT_COLUMNS.length) {
      setSelectedCols([]);
    } else {
      setSelectedCols(STOCK_REPORT_COLUMNS.map(c => c.id));
    }
  };

  const handleConfirm = () => {
    if (selectedCols.length === 0) {
      alert('Selecione ao menos uma coluna para incluir no relatório.');
      return;
    }
    onConfirm(selectedCols);
  };

  return (
    <AnimatePresence>
      <div 
        id="export-report-modal-overlay"
        className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs"
        onClick={onClose}
      >
        <motion.div
          id="export-report-modal-card"
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-neutral-200 flex flex-col max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-neutral-100 flex items-start justify-between bg-neutral-50/70">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0 shadow-xs">
                <Share2 size={20} />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-black text-neutral-900 leading-tight">
                  Compartilhar relatório
                </h3>
                <p className="text-xs text-neutral-500 font-medium mt-0.5 leading-snug">
                  Selecione as informações que deseja enviar no relatório.
                </p>
              </div>
            </div>

            <button
              id="export-report-close-btn"
              type="button"
              onClick={onClose}
              className="p-1.5 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/60 rounded-full transition-colors shrink-0"
              aria-label="Fechar"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body: Columns Selection */}
          <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-2">
            <div className="flex items-center justify-between pb-1 px-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                Colunas disponíveis ({selectedCols.length}/{STOCK_REPORT_COLUMNS.length})
              </span>
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-xs font-black text-orange-600 hover:text-orange-700 transition-colors cursor-pointer"
              >
                {selectedCols.length === STOCK_REPORT_COLUMNS.length ? 'Desmarcar todas' : 'Selecionar todas'}
              </button>
            </div>

            <div className="space-y-1.5">
              {STOCK_REPORT_COLUMNS.map((column, index) => {
                const isSelected = selectedCols.includes(column.id);

                return (
                  <label
                    key={column.id}
                    id={`export-col-option-${column.id}`}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer select-none min-h-[48px] ${
                      isSelected
                        ? 'bg-orange-50/50 border-orange-200 text-neutral-900 shadow-xs'
                        : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-bold text-neutral-400 w-4 text-center">
                        {index + 1}
                      </span>
                      <span className={`text-sm ${isSelected ? 'font-black text-neutral-900' : 'font-semibold text-neutral-700'}`}>
                        {column.label}
                      </span>
                    </div>

                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleColumn(column.id)}
                        className="sr-only"
                      />
                      <div
                        className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                          isSelected
                            ? 'bg-orange-600 border-orange-600 text-white shadow-xs'
                            : 'bg-white border-neutral-300'
                        }`}
                      >
                        {isSelected && <Check size={14} className="stroke-[3]" />}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-4 sm:p-5 border-t border-neutral-100 bg-neutral-50 flex items-center justify-end gap-2.5">
            <button
              id="export-report-cancel-btn"
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="px-4 py-2.5 rounded-xl border border-neutral-300 bg-white text-neutral-700 font-bold text-xs sm:text-sm hover:bg-neutral-100 active:scale-98 transition-all disabled:opacity-50 min-h-[42px]"
            >
              Cancelar
            </button>

            <button
              id="export-report-confirm-btn"
              type="button"
              onClick={handleConfirm}
              disabled={isGenerating || selectedCols.length === 0}
              className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 active:scale-98 text-white font-black text-xs sm:text-sm shadow-md shadow-orange-600/20 transition-all flex items-center gap-2 disabled:opacity-50 min-h-[42px]"
            >
              <Share2 size={16} />
              <span>{isGenerating ? 'Gerando PDF...' : 'Gerar PDF / Compartilhar'}</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
