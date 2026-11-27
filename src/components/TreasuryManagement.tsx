/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase } from '../types';
import { 
  Landmark, Vault, CreditCard, UserCheck, ArrowDownLeft, 
  ArrowUpRight, Repeat, Receipt, Lock, Coins, Copy
} from 'lucide-react';
import BankAccountsTab from './treasury/BankAccountsTab';
import CashDrawersTab from './treasury/CashDrawersTab';
import PosTerminalsTab from './treasury/PosTerminalsTab';
import CashiersTab from './treasury/CashiersTab';
import ReceiptsTab from './treasury/ReceiptsTab';
import PaymentsTab from './treasury/PaymentsTab';
import BarterTab from './treasury/BarterTab';
import CounterpartySettlementTab from './treasury/CounterpartySettlementTab';
import CashierShiftCloseoutTab from './treasury/CashierShiftCloseoutTab';
import ChequeBooksTab from './treasury/ChequeBooksTab';
import { CopySectionKey } from '../utils/periodCopyEngine';
import CopyFromPeriodModal from './ui/CopyFromPeriodModal';
import { ModuleHeader, ModulePrimaryTabs, ErpButton, ERP_BUTTON_LABELS } from './ui/UnifiedErpUi';

interface TreasuryManagementProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  askConfirm: (title: string, message: string, action: () => void) => void;
}

export type TreasurySubTab = 
  | 'bank_accounts' 
  | 'cash_drawers' 
  | 'pos_terminals' 
  | 'cashiers' 
  | 'cheque_books' 
  | 'receipts' 
  | 'payments' 
  | 'barter' 
  | 'settlement' 
  | 'closeout';

const TREASURY_COPY_MAP: Record<TreasurySubTab, CopySectionKey> = {
  receipts: 'treasuryReceipts',
  payments: 'treasuryPayments',
  barter: 'barterTransactions',
  settlement: 'counterpartySettlements',
  closeout: 'cashierShiftCloseouts',
  bank_accounts: 'bankAccounts',
  cheque_books: 'chequeBooks',
  cash_drawers: 'cashDrawers',
  pos_terminals: 'posTerminals',
  cashiers: 'cashiers',
};

export default function TreasuryManagement({ db, onUpdateDb, activePeriodId, askConfirm }: TreasuryManagementProps) {
  const [activeSubTab, setActiveSubTab] = useState<TreasurySubTab>('receipts');
  const [showCopyModal, setShowCopyModal] = useState(false);

  const activePeriod = useMemo(
    () => (db.periods || []).find(p => p.id === activePeriodId),
    [db.periods, activePeriodId]
  );

  const counts = useMemo(() => {
    const inPeriod = <T extends { periodId?: string }>(arr?: T[]) =>
      (arr || []).filter(item => item.periodId === activePeriodId);
    const receiptsArr = inPeriod(db.treasuryReceipts);
    const paymentsArr = inPeriod(db.treasuryPayments);
    const totalReceipts = receiptsArr.reduce((s, r) => s + (Number((r as any).totalAmount ?? (r as any).amount) || 0), 0);
    const totalPayments = paymentsArr.reduce((s, p) => s + (Number((p as any).totalAmount ?? (p as any).amount) || 0), 0);
    return {
      receipts: receiptsArr.length,
      payments: paymentsArr.length,
      barter: inPeriod(db.barterTransactions).length,
      settlement: inPeriod(db.counterpartySettlements).length,
      closeout: inPeriod(db.cashierShiftCloseouts).length,
      bank_accounts: inPeriod(db.bankAccounts).length,
      cheque_books: inPeriod(db.chequeBooks).length,
      cash_drawers: inPeriod(db.cashDrawers).length,
      pos_terminals: inPeriod(db.posTerminals).length,
      cashiers: inPeriod(db.cashiers).length,
      totalReceipts,
      totalPayments,
    };
  }, [db, activePeriodId]);

  const totalDocs = counts.receipts + counts.payments + counts.barter + counts.settlement + counts.closeout;

  return (
    <div className="space-y-6 animate-fadeIn pb-12 text-right font-sans" dir="rtl">
      <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <ModuleHeader
          icon={<Coins className="w-5 h-5" />}
          title="مدیریت وجوه نقد و بانک (خزانه‌داری)"
          subtitle="کنترل یکپارچه نقدینگی، حساب‌های بانکی، کارتخوان‌ها، صندوق‌داران، اسناد دریافت و پرداخت، تهاتر و تسویه روزانه (ایزوله در دوره فعال)"
          periodName={activePeriod?.name}
          recordCount={totalDocs}
          recordLabel="سند خزانه"
          actions={
            <ErpButton variant="secondary" size="sm" icon={<Copy className="w-3.5 h-3.5" />} onClick={() => setShowCopyModal(true)}>
              {ERP_BUTTON_LABELS.copyFromPeriod}
            </ErpButton>
          }
        />

        <ModulePrimaryTabs
          activeTab={activeSubTab}
          onChange={(id) => setActiveSubTab(id as TreasurySubTab)}
          tabs={[
            { id: 'receipts', label: 'دریافت وجه', icon: <ArrowDownLeft className="w-4 h-4" />, count: counts.receipts },
            { id: 'payments', label: 'پرداخت وجه', icon: <ArrowUpRight className="w-4 h-4" />, count: counts.payments },
            { id: 'barter', label: 'تهاتر کالا و خدمات', icon: <Repeat className="w-4 h-4" />, count: counts.barter },
            { id: 'settlement', label: 'تسویه طرف مقابل', icon: <Receipt className="w-4 h-4" />, count: counts.settlement },
            { id: 'closeout', label: 'بستن حساب صندوق‌دار', icon: <Lock className="w-4 h-4" />, count: counts.closeout },
            { id: 'bank_accounts', label: 'حساب‌های بانکی', icon: <Landmark className="w-4 h-4" />, count: counts.bank_accounts },
            { id: 'cheque_books', label: 'دسته‌چک و برگه‌ها', icon: <CreditCard className="w-4 h-4" />, count: counts.cheque_books },
            { id: 'cash_drawers', label: 'صندوق‌ها', icon: <Vault className="w-4 h-4" />, count: counts.cash_drawers },
            { id: 'pos_terminals', label: 'کارتخوان‌ها (POS)', icon: <CreditCard className="w-4 h-4" />, count: counts.pos_terminals },
            { id: 'cashiers', label: 'صندوق‌داران', icon: <UserCheck className="w-4 h-4" />, count: counts.cashiers },
          ]}
        />
      </div>

      {/* Tab Contents (Each tab renders its own KpiStrip -> UnifiedToolbar -> UnifiedFilterBar -> Table) */}
      <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-2xl sm:rounded-3xl shadow-xl p-3.5 sm:p-6 space-y-5 transition-all duration-300">
        {activeSubTab === 'bank_accounts' && (
          <BankAccountsTab db={db} onUpdateDb={onUpdateDb} activePeriodId={activePeriodId} askConfirm={askConfirm} />
        )}
        {activeSubTab === 'cash_drawers' && (
          <CashDrawersTab db={db} onUpdateDb={onUpdateDb} activePeriodId={activePeriodId} askConfirm={askConfirm} />
        )}
        {activeSubTab === 'pos_terminals' && (
          <PosTerminalsTab db={db} onUpdateDb={onUpdateDb} activePeriodId={activePeriodId} askConfirm={askConfirm} />
        )}
        {activeSubTab === 'cashiers' && (
          <CashiersTab db={db} onUpdateDb={onUpdateDb} activePeriodId={activePeriodId} askConfirm={askConfirm} />
        )}
        {activeSubTab === 'receipts' && (
          <ReceiptsTab db={db} onUpdateDb={onUpdateDb} activePeriodId={activePeriodId} askConfirm={askConfirm} />
        )}
        {activeSubTab === 'payments' && (
          <PaymentsTab db={db} onUpdateDb={onUpdateDb} activePeriodId={activePeriodId} askConfirm={askConfirm} />
        )}
        {activeSubTab === 'cheque_books' && (
          <ChequeBooksTab db={db} onUpdateDb={onUpdateDb} activePeriodId={activePeriodId} askConfirm={askConfirm} />
        )}
        {activeSubTab === 'barter' && (
          <BarterTab db={db} onUpdateDb={onUpdateDb} activePeriodId={activePeriodId} askConfirm={askConfirm} />
        )}
        {activeSubTab === 'settlement' && (
          <CounterpartySettlementTab db={db} onUpdateDb={onUpdateDb} activePeriodId={activePeriodId} askConfirm={askConfirm} />
        )}
        {activeSubTab === 'closeout' && (
          <CashierShiftCloseoutTab db={db} onUpdateDb={onUpdateDb} activePeriodId={activePeriodId} askConfirm={askConfirm} />
        )}
      </div>

      <CopyFromPeriodModal
        isOpen={showCopyModal}
        onClose={() => setShowCopyModal(false)}
        db={db}
        activePeriodId={activePeriodId}
        sectionKey={TREASURY_COPY_MAP[activeSubTab]}
        onUpdateDb={onUpdateDb}
      />
    </div>
  );
}
