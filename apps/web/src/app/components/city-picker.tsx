'use client';

import { useEffect, useRef, useState } from 'react';
import { CITY_OPTIONS, cityLabel } from '../../lib/cities';

type CityPickerProps = {
  value: string;
  onValueChange: (city: string) => void;
  isLoading?: boolean;
  label?: string;
};

export function CityPicker({ value, onValueChange, isLoading = false, label = 'Şehir' }: CityPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeWhenOutside(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('pointerdown', closeWhenOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return <div className="city-picker" ref={pickerRef}>
    <span>{label}</span>
    <button type="button" onClick={() => setIsOpen((open) => !open)} aria-haspopup="listbox" aria-expanded={isOpen} disabled={isLoading}>
      {cityLabel(value)}<i aria-hidden="true">⌄</i>
    </button>
    {isOpen && <div className="city-menu" role="listbox" aria-label="Şehir seç"><div>
      {CITY_OPTIONS.map(([city, displayName]) => <button type="button" role="option" aria-selected={city === value} className={city === value ? 'is-selected' : ''} onClick={() => { onValueChange(city); setIsOpen(false); }} key={city}>{displayName}</button>)}
    </div></div>}
  </div>;
}
