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

/** 工具卡成功态（替代 ✓ 字形）。 */
export function CheckIcon(): ReactElement {
  return svg(<path d="M3 8.4l3.2 3.2L13 4.8" />);
}

/** 工具卡失败态（替代 ✕ 字形）。 */
export function CloseIcon(): ReactElement {
  return svg(<path d="M4 4l8 8M12 4l-8 8" />);
}

/** 工具卡运行态（替代 ⚙ 字形）。 */
export function GearIcon(): ReactElement {
  return svg(
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M12.4 3.6l-1.3 1.3M4.9 11.1l-1.3 1.3" />
    </>,
  );
}

/** 折叠箭头（右向；展开态 CSS 旋转 90°，替代 ▸/▾ 字形）。 */
export function ChevronIcon(): ReactElement {
  return svg(<path d="M6 3.5L10.5 8 6 12.5" />);
}

/** 回到底部箭头（替代 ↓ 文本字形）。 */
export function ArrowDownIcon(): ReactElement {
  return svg(<path d="M8 2.5v10M4 8.8L8 12.8l4-4" />);
}

/* ----------------------------- 第九阶段：设置纵向导航图标 ----------------------------- */

/** 模型渠道（芯片形）。 */
export function ModelIcon(): ReactElement {
  return svg(
    <>
      <rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.2" />
      <path d="M6.6 1.8v1.6M9.4 1.8v1.6M6.6 12.6v1.6M9.4 12.6v1.6M1.8 6.6h1.6M1.8 9.4h1.6M12.6 6.6h1.6M12.6 9.4h1.6" />
    </>,
  );
}

/** 智能体预设（机器人头像）。 */
export function PresetIcon(): ReactElement {
  return svg(
    <>
      <rect x="2.8" y="5.2" width="10.4" height="7.6" rx="2" />
      <path d="M8 2.4v2.8M6.2 8.4h.01M9.8 8.4h.01M5.8 10.8h4.4" />
    </>,
  );
}

/** 工具注册（扳手）。 */
export function ToolsIcon(): ReactElement {
  return svg(
    <path d="M10.2 2.4a3.4 3.4 0 0 0-3.3 4.3L2.6 11a1.4 1.4 0 0 0 2 2l4.3-4.3a3.4 3.4 0 0 0 4.3-4.1l-2 2-1.9-1.9 2-2a3.4 3.4 0 0 0-1.1-.3z" />,
  );
}

/** 插件管理（拼图块）。 */
export function PluginIcon(): ReactElement {
  return svg(
    <path d="M6.2 2.4h3.6v2a1.4 1.4 0 1 0 2.8 0v-2h1.4v3.8h-2a1.4 1.4 0 1 0 0 2.8h2v4.6H9.8v-2a1.4 1.4 0 1 0-2.8 0v2H2.4V9.8h2a1.4 1.4 0 1 0 0-2.8h-2V2.4h3.8z" />,
  );
}

/** 工作区（文件夹）。 */
export function WorkspaceIcon(): ReactElement {
  return svg(<path d="M2 4.2h4.2l1.4 1.8h6.4v7.2H2V4.2zM2 7.4h12" />);
}

/** 关于（信息圆）。 */
export function InfoIcon(): ReactElement {
  return svg(
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v4M8 4.8h.01" />
    </>,
  );
}

/* ----------------------------- 第九阶段二梯队：composer 工具条 ----------------------------- */

/** 权限胶囊（盾形）。 */
export function ShieldIcon(): ReactElement {
  return svg(<path d="M8 1.8l5 2v4c0 3.2-2.1 5.2-5 6.4-2.9-1.2-5-3.2-5-6.4v-4l5-2zM5.8 8l1.6 1.6 2.8-3" />);
}

/** 思考胶囊（灯泡）。 */
export function BrainIcon(): ReactElement {
  return svg(
    <>
      <path d="M6.2 12.4h3.6M6.6 14h2.8M8 1.8a4 4 0 0 0-2.4 7.2c.5.4.8 1 .8 1.6h3.2c0-.6.3-1.2.8-1.6A4 4 0 0 0 8 1.8z" />
    </>,
  );
}
