"use client";

import { useId, useState, useEffect } from "react";

export function IndiaFlag({ className = "w-5 h-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 900 600"
      className={`${className} rounded-[2px] shadow-2xs overflow-hidden shrink-0 border border-black/10`}
      aria-label="Flag of India"
      role="img"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="900" height="200" fill="#FF9933" />
      <rect y="200" width="900" height="200" fill="#FFFFFF" />
      <rect y="400" width="900" height="200" fill="#128807" />
      <circle cx="450" cy="300" r="80" fill="none" stroke="#000080" strokeWidth="6" />
      <circle cx="450" cy="300" r="16" fill="#000080" />
      {Array.from({ length: 24 }).map((_, i) => (
        <line
          key={i}
          x1="450"
          y1="300"
          x2="450"
          y2="220"
          stroke="#000080"
          strokeWidth="3.5"
          transform={`rotate(${i * 15} 450 300)`}
        />
      ))}
    </svg>
  );
}

interface IndiaPhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
}

/** Extracts 10 national digits from any telephone string (e.g. "+91 98765 43210" -> "9876543210") */
export function extractNationalDigits(val: string): string {
  if (!val) return "";
  let s = val.trim();

  // If it explicitly starts with "+91", strip the "+91" country code prefix
  if (s.startsWith("+91")) {
    s = s.slice(3).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }

  // Extract all digit characters
  let digits = s.replace(/\D/g, "");

  // If user pasted 12 digits starting with 91 (e.g. "919876543210" without +):
  if (digits.length > 10 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }
  // If user pasted 11 digits starting with 0 (e.g. "09876543210"):
  else if (digits.length > 10 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  return digits.slice(0, 10);
}

/** Formats 10 digits as "XXXXX XXXXX" for readable display */
export function formatDisplayDigits(digits: string): string {
  if (!digits) return "";
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

export default function IndiaPhoneInput({
  value,
  onChange,
  onBlur,
  placeholder = "98765 43210",
  error,
  disabled = false,
  required = false,
  className = "",
  id: customId,
}: IndiaPhoneInputProps) {
  const autoId = useId();
  const inputId = customId || autoId;
  const [isFocused, setIsFocused] = useState(false);

  // Maintain local national digits state synced with external value
  const [displayDigits, setDisplayDigits] = useState(() =>
    formatDisplayDigits(extractNationalDigits(value))
  );

  useEffect(() => {
    const raw = extractNationalDigits(value);
    setDisplayDigits(formatDisplayDigits(raw));
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      const input = e.currentTarget;
      const { selectionStart, selectionEnd, value: curVal } = input;
      // If cursor is right after the space at index 5 (cursor position 6), backspacing should delete the digit before the space
      if (selectionStart !== null && selectionStart === selectionEnd && selectionStart === 6 && curVal[5] === " ") {
        e.preventDefault();
        const nextVal = curVal.slice(0, 4) + curVal.slice(6);
        const cleanDigits = extractNationalDigits(nextVal);
        const formatted = formatDisplayDigits(cleanDigits);
        setDisplayDigits(formatted);
        onChange(cleanDigits ? `+91 ${formatted}` : "");
        requestAnimationFrame(() => {
          input.setSelectionRange(4, 4);
        });
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputVal = e.target.value;
    const cleanDigits = extractNationalDigits(inputVal);
    const formatted = formatDisplayDigits(cleanDigits);
    setDisplayDigits(formatted);

    if (!cleanDigits) {
      onChange("");
    } else {
      // Store standard international format "+91 XXXXX XXXXX"
      onChange(`+91 ${formatted}`);
    }
  };

  return (
    <div className={`w-full ${className}`}>
      <div
        className={`relative flex items-center w-full h-11 border rounded-xl bg-white transition overflow-hidden ${
          error
            ? "border-red-400 ring-2 ring-red-500/20"
            : isFocused
            ? "border-[var(--color-admin-primary)] ring-2 ring-[var(--color-admin-primary-soft)]"
            : "border-gray-200 hover:border-gray-300"
        } ${disabled ? "opacity-60 bg-gray-50 cursor-not-allowed" : ""}`}
      >
        {/* Constant +91 Addon with Indian Flag */}
        <div className="flex items-center gap-2 pl-3.5 pr-2.5 py-2 bg-gray-50/80 border-r border-gray-200 select-none shrink-0 h-full">
          <IndiaFlag className="w-5 h-3.5 shadow-xs" />
          <span className="text-xs font-bold text-gray-800 tracking-tight">+91</span>
        </div>

        {/* 10-Digit Mobile Number Input */}
        <input
          id={inputId}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={displayDigits}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          onKeyDown={handleKeyDown}
          onChange={handleInputChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            setIsFocused(false);
            onBlur?.();
          }}
          className="flex-1 h-full px-3 text-sm text-gray-900 placeholder:text-gray-400 bg-transparent focus:outline-none disabled:cursor-not-allowed font-medium tracking-wide"
        />
      </div>
    </div>
  );
}
