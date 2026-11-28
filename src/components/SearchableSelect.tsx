/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';
import { matchPersianString } from '../utils/persianUtils';

export interface SearchableSelectOption {
  value: string;
  label: string;
  searchText?: string;
}

interface SearchableSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  variant?: 'light' | 'dark';
  className?: string;
  disabled?: boolean;
}

export default function SearchableSelect({
  id,
  value,
  onChange,
  options,
  placeholder = 'انتخاب کنید...',
  searchPlaceholder = 'جستجو در بین گزینه‌ها...',
  emptyText = 'موردی یافت نشد.',
  variant = 'light',
  className = '',
  disabled = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const isDark = variant === 'dark';

  // Deduplicate options by value to prevent duplicate UI elements
  const uniqueOptions = React.useMemo(() => {
    const seen = new Set<string>();
    return options.filter((opt) => {
      if (!opt || opt.value === undefined || opt.value === null) return false;
      const key = String(opt.value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [options]);

  // Find currently selected option
  const selectedOption = uniqueOptions.find((opt) => opt.value === value);

  // Filter options based on query (handles Persian/Arabic characters gracefully)
  const filteredOptions = React.useMemo(() => {
    if (!searchQuery.trim()) return uniqueOptions;
    return uniqueOptions.filter((opt) =>
      matchPersianString(opt.searchText || opt.label, searchQuery)
    );
  }, [uniqueOptions, searchQuery]);

  // Handle click outside to close the dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div ref={containerRef} className={`relative inline-block w-full text-right ${className}`} dir="rtl">
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-all font-sans cursor-pointer outline-none ${
          isDark
            ? 'rounded-xl border border-slate-800 bg-slate-950 hover:border-slate-700 text-white font-bold focus:border-rose-600 focus:ring-1 focus:ring-rose-500/30'
            : 'rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-950 font-black focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500'
        } ${
          disabled ? (isDark ? 'opacity-50 cursor-not-allowed bg-slate-900' : 'opacity-50 cursor-not-allowed bg-slate-50') : ''
        }`}
      >
        <span className="truncate">
          {selectedOption ? (
            selectedOption.label
          ) : (
            <span className={isDark ? 'text-slate-400 font-normal' : 'text-slate-400'}>{placeholder}</span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 mr-2 transition-transform ${isOpen ? 'rotate-180' : ''} ${isDark ? 'text-slate-400' : 'text-slate-400'}`} />
      </button>

      {isOpen && (
        <div
          className={`absolute z-50 mt-1 w-full rounded-xl shadow-2xl overflow-hidden animate-fade-in max-h-72 flex flex-col ${
            isDark
              ? 'bg-slate-900 border border-slate-700'
              : 'bg-white border border-slate-200'
          }`}
        >
          {/* Search box */}
          <div
            className={`p-2 border-b flex items-center gap-2 ${
              isDark ? 'border-slate-800 bg-slate-950' : 'border-slate-100 bg-slate-50'
            }`}
          >
            <Search className={`h-3.5 w-3.5 flex-shrink-0 ${isDark ? 'text-slate-400' : 'text-slate-405'}`} />
            <input
              type="text"
              placeholder={searchPlaceholder}
              className={`w-full bg-transparent border-none text-xs outline-none py-1 focus:ring-0 font-sans ${
                isDark ? 'text-slate-100 placeholder-slate-500' : 'text-slate-800 placeholder-slate-400'
              }`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>

          {/* List of options */}
          <div
            className={`overflow-y-auto flex-1 py-1 max-h-56 divide-y ${
              isDark ? 'divide-slate-800/60' : 'divide-slate-50'
            }`}
          >
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt, optIdx) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={`${opt.value}-${optIdx}`}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full text-right px-3.5 py-2.5 text-xs font-sans flex items-center justify-between transition-all cursor-pointer ${
                      isDark
                        ? isSelected
                          ? 'bg-rose-500/20 text-rose-200 font-black'
                          : 'text-slate-200 hover:bg-slate-800 hover:text-white font-bold'
                        : isSelected
                          ? 'bg-rose-50 text-rose-700 font-black'
                          : 'text-slate-900 hover:bg-rose-50/50 hover:text-rose-950 font-bold'
                    }`}
                  >
                    <span className="truncate">{opt.label}</span>
                    {isSelected && <Check className={`h-3.5 w-3.5 flex-shrink-0 ${isDark ? 'text-rose-400' : 'text-rose-600'}`} />}
                  </button>
                );
              })
            ) : (
              <div className={`px-4 py-4 text-center text-xs font-sans ${isDark ? 'text-slate-400' : 'text-slate-400'}`}>
                {emptyText}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
