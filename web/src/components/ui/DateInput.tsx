import { toLocalISODate } from '../../utils/period';

export interface DateInputProps {
  id?: string;
  value: string;
  onChange: (nextDate: string) => void;
  required?: boolean;
  disabled?: boolean;
  showShortcuts?: boolean;
  error?: string | null;
}

function getYesterdayISODate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toLocalISODate(d);
}

export function DateInput({
  id,
  value,
  onChange,
  required = false,
  disabled = false,
  showShortcuts = false,
  error,
}: DateInputProps) {
  const today = toLocalISODate();
  const yesterday = getYesterdayISODate();
  const errorId = id ? `${id}-error` : undefined;

  return (
    <div className="date-input-container">
      <div className={`date-input-group ${error ? 'input-invalid' : ''}`}>
        <span className="date-input-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <rect
              x="3"
              y="4"
              width="18"
              height="18"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.9"
            />
            <path
              d="M16 2v4M8 2v4M3 10h18"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <input
          id={id}
          type="date"
          required={required}
          disabled={disabled}
          value={value}
          aria-invalid={Boolean(error)}
          aria-describedby={error && errorId ? errorId : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>

      {showShortcuts && (
        <div className="date-shortcuts" role="group" aria-label="Atalhos de data">
          <button
            type="button"
            className={`date-shortcut-chip ${value === today ? 'active' : ''}`}
            onClick={() => onChange(today)}
          >
            Hoje
          </button>
          <button
            type="button"
            className={`date-shortcut-chip ${value === yesterday ? 'active' : ''}`}
            onClick={() => onChange(yesterday)}
          >
            Ontem
          </button>
        </div>
      )}

      {error && (
        <span id={errorId} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
