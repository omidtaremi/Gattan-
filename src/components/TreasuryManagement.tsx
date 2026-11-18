/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AppDatabase } from '../types';
import { 
  Landmark, Vault, CreditCard, UserCheck, ArrowDownLeft, 
  ArrowUpRight, Repeat, Receipt, Lock, Wallet, Coins
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

export default function TreasuryManagement({ db, onUpdateDb, activePeriodId, askConfirm }: TreasuryManagementProps) {
  const [activeSubTab, setActiveSubTab] = useState<TreasurySubTab>('receipts');

  const subTabs = [
    {
      id: 'receipts' as TreasurySubTab,
      label: 'دریافت وجه (نقد / پوز / حواله / چک)',
      shortLabel: 'دریافت',
      icon: ArrowDownLeft,
      color: 'text-emerald-400',
      badge: (db.treasuryReceipts || []).length
    },
    {
      id: 'payments' as TreasurySubTab,
      label: 'پرداخت وجه (حواله / نقد / صدور چک)',
      shortLabel: 'پرداخت',
      icon: ArrowUpRight,
      color: 'text-rose-400',
      badge: (db.treasuryPayments || []).length
    },
    {
      id: 'barter' as TreasurySubTab,
      label: 'تهاتر کالا و خدمات',
      shortLabel: 'تهاتر',
      icon: Repeat,
      color: 'text-indigo-400',
      badge: (db.barterTransactions || []).length
    },
    {
      id: 'settlement' as TreasurySubTab,
      label: 'تسویه حساب طرف مقابل',
      shortLabel: 'تسویه طرفین',
      icon: Receipt,
      color: 'text-cyan-400',
      badge: (db.counterpartySettlements || []).length
    },
    {
      id: 'closeout' as TreasurySubTab,
      label: 'تسویه حساب و بستن روزانه صندوق‌دار',
      shortLabel: 'بستن حساب صندوق‌دار',
      icon: Lock,
      color: 'text-amber-400',
      badge: (db.cashierShiftCloseouts || []).length
    },
    {
      id: 'bank_accounts' as TreasurySubTab,
      label: 'تعریف حساب‌های بانکی',
      shortLabel: 'حساب‌های بانکی',
      icon: Landmark,
      color: 'text-blue-400',
      badge: (db.bankAccounts || []).length
    },
    {
      id: 'cheque_books' as TreasurySubTab,
      label: 'مدیریت دسته‌چک و برگه‌ها (هشدار سررسید)',
      shortLabel: 'دسته‌چک‌ها',
      icon: CreditCard,
      color: 'text-teal-400',
      badge: (db.chequeBooks || []).length
    },
    {
      id: 'cash_drawers' as TreasurySubTab,
      label: 'تعریف صندوق‌ها',
      shortLabel: 'صندوق‌ها',
      icon: Vault,
      color: 'text-amber-400',
      badge: (db.cashDrawers || []).length
    },
    {
      id: 'pos_terminals' as TreasurySubTab,
      label: 'تعریف کارتخوان‌ها (POS)',
      shortLabel: 'کارتخوان‌ها',
      icon: CreditCard,
      color: 'text-purple-400',
      badge: (db.posTerminals || []).length
    },
    {
      id: 'cashiers' as TreasurySubTab,
      label: 'تعریف صندوق‌داران',
      shortLabel: 'صندوق‌داران',
      icon: UserCheck,
      color: 'text-emerald-400',
      badge: (db.cashiers || []).length
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none translate-x-1/2 translate-y-1/2" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-400 shadow-inner">
              <Coins className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white flex items-center gap-2">
                مدیریت وجوه نقد و بانک (خزانه‌داری)
                <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2.5 py-0.5 rounded-full border border-emerald-500/20 font-mono">
                  GATAN TREASURY
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                کنترل یکپارچه نقدینگی، حساب‌های بانکی، کارتخوان‌ها، صندوق‌داران، اسناد دریافت و پرداخت، تهاتر کالا و تسویه حساب‌های روزانه
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Sub Navigation Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-800/80 scrollbar-thin scrollbar-thumb-slate-800">
        {subTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 rounded-2xl text-xs font-bold whitespace-nowrap transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'bg-slate-800 text-white shadow-lg border border-slate-700'
                  : 'bg-slate-900/60 text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-slate-900'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? tab.color : 'text-slate-400'}`} />
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                  isActive ? 'bg-slate-950 text-emerald-400 border border-slate-700' : 'bg-slate-800/80 text-slate-400'
                }`}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Contents */}
      <div className="transition-all duration-300">
        {activeSubTab === 'bank_accounts' && (
          <BankAccountsTab 
            db={db} 
            onUpdateDb={onUpdateDb} 
            activePeriodId={activePeriodId} 
            askConfirm={askConfirm} 
          />
        )}

        {activeSubTab === 'cash_drawers' && (
          <CashDrawersTab 
            db={db} 
            onUpdateDb={onUpdateDb} 
            activePeriodId={activePeriodId} 
            askConfirm={askConfirm} 
          />
        )}

        {activeSubTab === 'pos_terminals' && (
          <PosTerminalsTab 
            db={db} 
            onUpdateDb={onUpdateDb} 
            activePeriodId={activePeriodId} 
            askConfirm={askConfirm} 
          />
        )}

        {activeSubTab === 'cashiers' && (
          <CashiersTab 
            db={db} 
            onUpdateDb={onUpdateDb} 
            activePeriodId={activePeriodId} 
            askConfirm={askConfirm} 
          />
        )}

        {activeSubTab === 'receipts' && (
          <ReceiptsTab 
            db={db} 
            onUpdateDb={onUpdateDb} 
            activePeriodId={activePeriodId} 
            askConfirm={askConfirm} 
          />
        )}

        {activeSubTab === 'payments' && (
          <PaymentsTab 
            db={db} 
            onUpdateDb={onUpdateDb} 
            activePeriodId={activePeriodId} 
            askConfirm={askConfirm} 
          />
        )}

        {activeSubTab === 'cheque_books' && (
          <ChequeBooksTab 
            db={db} 
            onUpdateDb={onUpdateDb} 
            activePeriodId={activePeriodId} 
            askConfirm={askConfirm} 
          />
        )}

        {activeSubTab === 'barter' && (
          <BarterTab 
            db={db} 
            onUpdateDb={onUpdateDb} 
            activePeriodId={activePeriodId} 
            askConfirm={askConfirm} 
          />
        )}

        {activeSubTab === 'settlement' && (
          <CounterpartySettlementTab 
            db={db} 
            onUpdateDb={onUpdateDb} 
            activePeriodId={activePeriodId} 
            askConfirm={askConfirm} 
          />
        )}

        {activeSubTab === 'closeout' && (
          <CashierShiftCloseoutTab 
            db={db} 
            onUpdateDb={onUpdateDb} 
            activePeriodId={activePeriodId} 
            askConfirm={askConfirm} 
          />
        )}
      </div>
    </div>
  );
}
