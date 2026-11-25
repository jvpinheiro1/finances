import React, { useState } from 'react';
import { sanitizeMoneyInput, validateMoneyInput } from '../utils/format';

export interface MoneyInputProps {
  id?: string;
  value: string;
  onChange: (nextValue: string) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  variant?: 'default' | 'hero' | 'compact';
  ariaLabel?: string;
  externalError?: string | null;
  maxCents?: number;
}

export function MoneyInput({
  id,
  value,
  onChange,
  placeholder = '0,00',
  required = false,
  autoFocus = false,
  disabled = false,
  variant = 'default',
  ariaLabel,
  externalError,
  maxCents,
}: MoneyInputProps) {
  const [liveWarning, setLiveWarning] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const { value: sanitized, warning } = sanitizeMoneyInput(raw);
    setLiveWarning(warning);
    onChange(sanitized);
  }

  function handleBlur() {
    setTouched(true);
    setLiveWarning(null);
  }

  const validationError =
    externalError || (touched ? validateMoneyInput(value, { required, maxCents }) : null);
  const messageToShow = validationError || liveWarning;
  const errorId = id ? `${id}-error` : undefined;

  if (variant === 'hero') {
    return (
      <div className="money-hero-wrapper">
        <div className="amount-hero-input-row">
          <span className="amount-hero-prefix">R$</span>
          <input
            id={id}
            className={`amount-hero-input ${validationError ? 'input-invalid' : ''}`}
            type="text"
            inputMode="decimal"
            required={required}
            autoFocus={autoFocus}
            disabled={disabled}
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-invalid={Boolean(validationError)}
            aria-describedby={messageToShow && errorId ? errorId : undefined}
            value={value}
            onChange={handleChange}
            onBlur={handleBlur}
          />
        </div>
        {messageToShow && (
          <span id={errorId} className="field-error" role="alert">
            {messageToShow}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`money-input-container ${variant === 'compact' ? 'money-input-compact' : ''}`}>
      <div className={`money-input-group ${validationError ? 'input-invalid' : ''}`}>
        <span className="money-input-prefix" aria-hidden="true">
          R$
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          required={required}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={Boolean(validationError)}
          aria-describedby={messageToShow && errorId ? errorId : undefined}
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
        />
      </div>
      {messageToShow && (
        <span id={errorId} className="field-error" role="alert">
          {messageToShow}
        </span>
      )}
    </div>
  );
}
