import React from 'react';

export interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string | null;
}

export function SelectField({ id, error, className = '', children, ...rest }: SelectFieldProps) {
  const errorId = id ? `${id}-error` : undefined;

  return (
    <div className="select-field-container">
      <select
        id={id}
        className={`${className} ${error ? 'input-invalid' : ''}`.trim()}
        aria-invalid={Boolean(error)}
        aria-describedby={error && errorId ? errorId : undefined}
        {...rest}
      >
        {children}
      </select>
      {error && (
        <span id={errorId} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
