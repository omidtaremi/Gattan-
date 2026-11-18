/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';
import { matchPersianString } from '../utils/persianUtils';

interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export default function SearchableSelect({
  id,
  value,
  onChange,
  options,
  placeholder = 'انتخاب کنید...',
  className = '',
  disabled = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

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
    return uniqueOptions.filter((opt) =>
      matchPersianString(opt.label, searchQuery)
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
        className={`w-full flex items-center justify-between px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-all font-sans cursor-pointer focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none text-slate-950 font-black ${
          disabled ? 'opacity-50 cursor-not-allowed bg-slate-50' : ''
        }`}
      >
        <span className="truncate">
          {selectedOption ? selectedOption.label : <span className="text-slate-400">{placeholder}</span>}
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0 mr-2" />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden animate-fade-in max-h-72 flex flex-col">
          {/* Search box */}
          <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-slate-405 flex-shrink-0" />
            <input
              type="text"
              placeholder="جستجو در بین گزینه‌ها..."
              className="w-full bg-transparent border-none text-xs outline-none py-1 focus:ring-0 text-slate-800 placeholder-slate-400 font-sans"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>

          {/* List of options */}
          <div className="overflow-y-auto flex-1 py-1 max-h-56 divide-y divide-slate-50">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt, optIdx) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={`${opt.value}-${optIdx}`}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full text-right px-4 py-2.5 text-xs font-sans flex items-center justify-between hover:bg-rose-50/50 hover:text-rose-950 transition-all cursor-pointer ${
                      isSelected ? 'bg-rose-50 text-rose-700 font-black' : 'text-slate-900 font-bold'
                    }`}
                  >
                    <span className="truncate">{opt.label}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-rose-600 flex-shrink-0" />}
                  </button>
                );
              })
            ) : (
              <div className="px-4 py-4 text-slate-400 text-center text-xs font-sans">
                موردی یافت نشد.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
