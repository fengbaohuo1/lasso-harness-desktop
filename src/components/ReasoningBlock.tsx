/**
 * 思考内容折叠块（P9-8，对齐 dsh details.reasoning-block）：
 * - summary = 呼吸圆点 + 标签「思考中」（流式）/「思考过程」（静止）+ chevron；
 * - 流式思考期自动展开、正文开始（streaming 收尾）自动收起；用户手动开合后尊重用户；
 * - 内容保留换行，max-height 220px 内滚动。
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

export interface ReasoningBlockProps {
  /** 思考文本（累积）。 */
  text: string;
  /** 思考是否仍在流入（决定「思考中」标签与自动展开）。 */
  streaming: boolean;
}

export default function ReasoningBlock({ text, streaming }: ReasoningBlockProps): ReactElement | null {
  const [expanded, setExpanded] = useState(streaming);
  const userTouchedRef = useRef(false);
  const prevStreamingRef = useRef(streaming);

  // 自动开合（仅未被用户接管时）：思考流入展开、思考结束收起
  useEffect(() => {
    if (userTouchedRef.current) {
      prevStreamingRef.current = streaming;
      return;
    }
    if (streaming && !prevStreamingRef.current) {
      setExpanded(true);
    } else if (!streaming && prevStreamingRef.current) {
      setExpanded(false);
    }
    prevStreamingRef.current = streaming;
  }, [streaming]);

  if (!text) {
    return null;
  }

  const toggle = (): void => {
    userTouchedRef.current = true;
    setExpanded((prev) => !prev);
  };

  return (
    <div className={`reasoning-block${streaming ? ' reasoning-block--live' : ''}`}>
      <button
        type="button"
        className="reasoning-block__summary"
        aria-expanded={expanded}
        onClick={toggle}
      >
        <span className="reasoning-dot" aria-hidden="true" />
        <span className="reasoning-block__label">{streaming ? '思考中' : '思考过程'}</span>
        <span
          className={`tool-card__chevron${expanded ? ' tool-card__chevron--open' : ''}`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M6 3.5L10.5 8 6 12.5" />
          </svg>
        </span>
      </button>
      {expanded ? <pre className="reasoning-block__content">{text}</pre> : null}
    </div>
  );
}
