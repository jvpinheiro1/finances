import { CategoryIconKind, getCategoryVisual } from '../utils/categoryVisuals';

function renderIconPath(kind: CategoryIconKind, initial: string) {
  switch (kind) {
    case 'food':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 3h2l2.2 10.5a2 2 0 0 0 2 1.5h7.3a2 2 0 0 0 1.9-1.4L21 7H7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="19" r="1.5" fill="currentColor" />
          <circle cx="17" cy="19" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'home':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1v-8.5z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'bills':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M13 2L4 14h7l-1 8 10-12h-7l0-8z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'transport':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 11l1.8-5h10.4L19 11M4 11h16v6a1 1 0 0 1-1 1h-1v2h-2v-2H8v2H6v-2H5a1 1 0 0 1-1-1v-6z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="7.5" cy="14.5" r="1.25" fill="currentColor" />
          <circle cx="16.5" cy="14.5" r="1.25" fill="currentColor" />
        </svg>
      );
    case 'health':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M12 9v4M10 11h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'leisure':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect
            x="3"
            y="6"
            width="18"
            height="12"
            rx="2"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path d="M10 9.5l5 2.5-5 2.5v-5z" fill="currentColor" />
        </svg>
      );
    case 'education':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 4L2 9l10 5 10-5-10-5zM6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'pet':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="7" cy="9" r="1.8" fill="currentColor" />
          <circle cx="12" cy="7" r="1.8" fill="currentColor" />
          <circle cx="17" cy="9" r="1.8" fill="currentColor" />
          <path
            d="M8 15.5c0-2 1.8-3.5 4-3.5s4 1.5 4 3.5c0 1.6-1.3 2.5-4 2.5s-4-.9-4-2.5z"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      );
    case 'subscription':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M17 3l4 4-4 4M3 11V9a2 2 0 0 1 2-2h16M7 21l-4-4 4-4m14-1v2a2 2 0 0 1-2 2H3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'shopping':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 7h12l1 13H5L6 7zM9 7V5a3 3 0 0 1 6 0v2"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return <span aria-hidden="true">{initial}</span>;
  }
}

export function CategoryIconBadge({
  name,
  categoryId,
  size = 'md',
}: {
  name: string;
  categoryId?: string;
  size?: 'md' | 'lg';
}) {
  const visual = getCategoryVisual(name, categoryId);
  return (
    <span
      className={`category-circle ${size === 'lg' ? 'category-circle-lg' : ''}`}
      style={{ color: visual.colorVar }}
      aria-hidden="true"
    >
      {renderIconPath(visual.icon, visual.initial)}
    </span>
  );
}
