/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { KeyRound, ShieldAlert, UserCheck, Smartphone, RefreshCw, LogIn, Server } from 'lucide-react';
import { toPersianDigits } from '../utils/persianUtils';
import {
  loginWithPostgres,
  type PublicUserSummary,
} from '../services/postgresSyncService';

interface LoginScreenProps {
  users: User[];
  serverMode: 'postgres' | 'local';
  publicUsers?: PublicUserSummary[];
  onLoginSuccess: (user: User) => void;
}

export default function LoginScreen({
  users,
  serverMode,
  publicUsers,
  onLoginSuccess,
}: LoginScreenProps) {
  const selectableUsers =
    serverMode === 'postgres' && publicUsers && publicUsers.length > 0
      ? publicUsers
      : users;

  const [selectedUsername, setSelectedUsername] = useState(
    selectableUsers[0]?.username || 'admin'
  );
  const [password, setPassword] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryUsername, setRecoveryUsername] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');

  // 2FA state
  const [step, setStep] = useState<'credentials' | '2fa'>('credentials');
  const [enteredCode, setEnteredCode] = useState('');
  const [mfaError, setMfaError] = useState('');
  const [mfaHint, setMfaHint] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tempUser, setTempUser] = useState<User | null>(null);

  useEffect(() => {
    if (selectableUsers.length > 0 && !selectableUsers.some((u) => u.username === selectedUsername)) {
      setSelectedUsername(selectableUsers[0].username);
    }
  }, [selectableUsers, selectedUsername]);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setMfaHint('');

    if (serverMode === 'postgres') {
      setIsSubmitting(true);
      try {
        const res = await loginWithPostgres(selectedUsername, password);
        if (res.ok && res.user) {
          onLoginSuccess(res.user);
        } else if (res.requires2FA && res.user) {
          setTempUser(res.user);
          setStep('2fa');
        } else {
          setLoginError(res.error || 'نام کاربری یا رمز عبور اشتباه است.');
        }
      } catch {
        setLoginError('خطا در برقراری ارتباط با سرور احراز هویت PostgreSQL.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Local / Offline mode fallback
    const found = users.find(
      (u) => u.username === selectedUsername && u.password === password
    );

    if (found) {
      if (found.is2FA) {
        setTempUser(found);
        setStep('2fa');
        setMfaHint(`کد تایید دو مرحله‌ای (حالت آفلاین): ${found.secretCode}`);
      } else {
        onLoginSuccess(found);
      }
    } else {
      setLoginError('نام کاربری یا رمز عبور اشتباه است (رمز پیش‌فرض تمامی کاربران 123 است)');
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMfaError('');

    if (serverMode === 'postgres') {
      setIsSubmitting(true);
      try {
        const res = await loginWithPostgres(selectedUsername, password, enteredCode);
        if (res.ok && res.user) {
          onLoginSuccess(res.user);
        } else {
          setMfaError(res.error || 'کد امنیتی دو مرحله‌ای وارد شده معتبر نمی‌باشد.');
        }
      } catch {
        setMfaError('خطا در ارتباط با سرور هنگام بررسی کد تایید.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (tempUser && enteredCode === tempUser.secretCode) {
      onLoginSuccess(tempUser);
    } else {
      setMfaError('کد امنیتی دو مرحله‌ای وارد شده معتبر نمی‌باشد.');
    }
  };

  const handleRecovery = (e: React.FormEvent) => {
    e.preventDefault();
    if (serverMode === 'postgres') {
      setRecoveryMessage('در حالت اتصال به PostgreSQL، برای بازنشانی رمز عبور با مدیر ارشد سیستم تماس بگیرید.');
      return;
    }
    const found = users.find((u) => u.username === recoveryUsername);
    if (found) {
      setRecoveryMessage(`رمز عبور شما: "${found.password}" می‌باشد. رمز امنیتی دو مرحله‌ای شما: "${found.secretCode}" است.`);
    } else {
      setRecoveryMessage('کاربری با این شناسه یافت نشد.');
    }
  };

  if (showRecovery) {
    return (
      <div className="min-h-screen bg-[#09090b] text-[#fafafa] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans" dir="rtl">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <div className="flex justify-center text-emerald-500 font-bold text-3xl">سامانه جامع گاتان</div>
          <h2 className="mt-6 text-center text-xl font-bold text-zinc-100 tracking-tight">بازیابی رمز عبور و دسترسی دو مرحله‌ای</h2>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="glass-card py-8 px-6 shadow-2xl rounded-3xl sm:px-10">
            <form onSubmit={handleRecovery} className="space-y-6">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-2">نام کاربری متقاضی را وارد کنید</label>
                <div className="mt-1">
                  <input
                    type="text"
                    required
                    value={recoveryUsername}
                    onChange={(e) => setRecoveryUsername(e.target.value)}
                    placeholder="مانند admin یا acc"
                    className="block w-full px-4 py-3 bg-zinc-900/60 border border-zinc-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-all"
                  />
                </div>
              </div>

              {recoveryMessage && (
                <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400 text-xs border border-emerald-500/20 leading-relaxed">
                  {recoveryMessage}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="submit"
                  className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors cursor-pointer"
                >
                  تایید و بازیابی اطلاعات
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowRecovery(false);
                    setRecoveryMessage('');
                  }}
                  className="w-full flex justify-center py-3 px-4 border border-zinc-800 rounded-xl text-xs font-bold text-zinc-300 bg-zinc-900 hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  بازگشت به صفحه ورود
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-[#fafafa] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans" dir="rtl">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 mb-4 font-mono select-none">
          {serverMode === 'postgres' ? (
            <>
              <Server className="h-3 w-3" /> ● POSTGRESQL_SHARED_SERVER
            </>
          ) : (
            '● SYSTEM_LOCAL_OFFLINE_ACTIVE'
          )}
        </span>
        <h1 className="text-3xl font-extrabold text-[#fafafa] tracking-tight">سامانه جامع گاتان</h1>
        <p className="mt-2 text-xs text-zinc-400">
          پنل پرسنلی یکپارچه انبارداری، مدیریت قیمت تمام شده، خرید و سفارش کالا
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="glass-card py-8 px-6 shadow-2xl rounded-3xl sm:px-10">
          {step === 'credentials' ? (
            <form onSubmit={handleCredentialsSubmit} className="space-y-5">
              <div>
                <label htmlFor="username-select" className="block text-xs font-semibold text-zinc-400 mb-2">کاربر سیستم</label>
                <div className="mt-1 relative">
                  {selectableUsers.length > 0 ? (
                    <select
                      id="username-select"
                      value={selectedUsername}
                      onChange={(e) => setSelectedUsername(e.target.value)}
                      className="block w-full pl-3 pr-10 py-3 text-sm bg-zinc-900/60 border border-zinc-800 rounded-xl text-zinc-100 focus:border-emerald-500 outline-none transition-all cursor-pointer"
                    >
                      {selectableUsers.map((u) => (
                        <option key={u.id || u.username} value={u.username} className="bg-zinc-950 text-zinc-150">
                          {u.fullName} ({u.role})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="username-select"
                      type="text"
                      required
                      value={selectedUsername}
                      onChange={(e) => setSelectedUsername(e.target.value)}
                      placeholder="نام کاربری (مثلا admin)"
                      className="block w-full px-4 py-3 text-sm bg-zinc-900/60 border border-zinc-800 rounded-xl text-zinc-100 focus:border-emerald-500 outline-none transition-all"
                      dir="ltr"
                    />
                  )}
                  <UserCheck className="absolute left-3 top-3.5 h-4 w-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              <div>
                <label htmlFor="password-input" className="block text-xs font-semibold text-zinc-400 mb-2">کلید عبور</label>
                <div className="mt-1 relative">
                  <input
                    id="password-input"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="رمز ورود"
                    className="block w-full px-4 py-3 bg-zinc-900/60 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-650 focus:border-emerald-500 outline-none transition-all"
                  />
                  <KeyRound className="absolute left-3 top-3.5 h-4 w-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              {loginError && (
                <div className="flex items-center gap-2 p-3 text-xs bg-red-950/40 text-red-450 border border-red-500/20 rounded-xl">
                  <ShieldAlert className="h-4 w-4 flex-shrink-0 text-red-500" />
                  <span>{loginError}</span>
                </div>
              )}

              {serverMode === 'local' && (
                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => setShowRecovery(true)}
                    className="font-semibold text-emerald-400 hover:text-emerald-350 transition-colors"
                  >
                    بازیابی رمز عبور و تست‌های امنیتی؟
                  </button>
                </div>
              )}

              <div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-xl shadow-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition-all duration-200 cursor-pointer disabled:opacity-60"
                >
                  {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogIn className="h-4.5 w-4.5" />}
                  {isSubmitting ? 'در حال احراز هویت...' : 'ورود امن به سامانه'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleMfaSubmit} className="space-y-6">
              <div className="text-center">
                <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-emerald-500/10 text-emerald-400 mb-3 border border-emerald-500/20">
                  <Smartphone className="h-6 w-6" />
                </div>
                <h3 className="text-base font-bold text-zinc-100">احراز خط دوم تایید دو مرحله‌ای (MFA)</h3>
                <p className="text-xs text-zinc-405 mt-2 leading-relaxed">
                  کد تایید {toPersianDigits(6)} رقمی حساب خود را در کادر زیر وارد نمایید.
                </p>
              </div>

              {mfaHint && (
                <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 text-xs text-center font-mono">
                  {mfaHint}
                </div>
              )}

              <div>
                <label htmlFor="mfa-code-input" className="block text-xs font-semibold text-zinc-400 mb-2 text-center">کد احراز امنیتی</label>
                <div className="mt-2 text-center">
                  <input
                    id="mfa-code-input"
                    type="text"
                    required
                    maxLength={6}
                    value={enteredCode}
                    onChange={(e) => setEnteredCode(e.target.value)}
                    placeholder="------"
                    className="block w-40 mx-auto px-3 py-3 text-center text-xl font-mono border border-zinc-850 rounded-xl focus:border-emerald-500 bg-zinc-900/65 text-zinc-100 tracking-widest outline-none transition-all"
                  />
                </div>
              </div>

              {mfaError && (
                <div className="flex items-center gap-2 p-3 text-xs bg-red-950/40 text-red-400 border border-red-500/20 rounded-xl">
                  <ShieldAlert className="h-4 w-4 flex-shrink-0 text-red-500" />
                  <span>{mfaError}</span>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors cursor-pointer"
                >
                  بررسی و ورود
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('credentials');
                    setEnteredCode('');
                    setTempUser(null);
                  }}
                  className="w-full flex justify-center py-3 px-4 border border-zinc-800 rounded-xl text-xs font-bold text-zinc-300 bg-zinc-900 hover:bg-zinc-805 transition-colors cursor-pointer"
                >
                  لغو
                </button>
              </div>
            </form>
          )}

          {/* Quick Info Box */}
          <div className="mt-8 pt-5 border-t border-zinc-800/80 text-[10.5px] text-zinc-400 text-center space-y-1 bg-zinc-950/40 -mx-6 -mb-8 px-6 py-4 rounded-b-3xl">
            <div className="text-zinc-500">کاربران پیش‌فرض اولیه سیستم:</div>
            <div className="font-semibold text-zinc-300">مدیر اصلی: admin | حسابدار: acc | انباردار: store</div>
            <div>رمز اولیه همگی: <span className="font-mono bg-zinc-850 px-1.5 py-0.5 rounded text-emerald-400 font-bold">123</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
