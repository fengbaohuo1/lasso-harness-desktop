/**
 * 内联 SVG 图标集（零图标库依赖）：主题/发送/停止/侧栏/会话操作等。
 * 统一 16 视口、stroke=currentColor，颜色由 CSS 变量经 color 控制。
 */

import type { ReactElement } from 'react';

function svg(path: ReactElement, viewBox = '0 0 16 16'): ReactElement {
  return (
    <svg viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      {path}
    </svg>
  );
}

export function SunIcon(): ReactElement {
  return svg(
    <>
      <circle cx="8" cy="8" r="3.2" />
      <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1" />
    </>,
  );
}

export function MoonIcon(): ReactElement {
  return svg(<path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1z" />);
}

export function MonitorIcon(): ReactElement {
  return svg(
    <>
      <rect x="1.8" y="2.8" width="12.4" height="8.4" rx="1.2" />
      <path d="M5.6 13.6h4.8M8 11.6v2" />
    </>,
  );
}

export function SendIcon(): ReactElement {
  return svg(<path d="M2 8l11.5-5.5L11 14l-3-4.2L2 8zM8 9.8L13.5 2.5" />);
}

export function StopIcon(): ReactElement {
  return svg(<rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.2" fill="currentColor" stroke="none" />);
}

export function PlusIcon(): ReactElement {
  return svg(<path d="M8 3v10M3 8h10" />);
}

export function SearchIcon(): ReactElement {
  return svg(
    <>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2L14 14" />
    </>,
  );
}

export function EditIcon(): ReactElement {
  return svg(<path d="M9.6 2.6l3.8 3.8-7.2 7.2-4.4.6.6-4.4 7.2-7.2zM8.4 3.8l3.8 3.8" />);
}

export function TrashIcon(): ReactElement {
  return svg(
    <>
      <path d="M2.8 4.2h10.4M5.6 4.2V2.6h4.8v1.6M4.2 4.2l.7 9h6.2l.7-9" />
      <path d="M6.6 6.6v4.4M9.4 6.6v4.4" />
    </>,
  );
}

export function PanelIcon(): ReactElement {
  return svg(
    <>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.2" />
      <path d="M6.2 2.8v10.4" />
    </>,
  );
}

export function RefreshIcon(): ReactElement {
  return svg(
    <>
      <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.7" />
      <path d="M13.4 1.8v3h-3" />
    </>,
  );
}
