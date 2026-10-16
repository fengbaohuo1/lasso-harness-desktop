/**
 * 思考内容折叠块（P9-8 建立，P11-14 重做）：
 *
 * 此前是不可展开的「呼吸圆点 + 思考过程」灰底长条，只有标签没有信息量，一屏里很显眼却看不出
 * 思考了什么；对齐 dsh 的做法改为**紧凑单行**：`思考 · <首行摘要>` + chevron，展开才显示全文，
 * 且不再有卡片面与色条。
 *
 * - 流式思考期自动展开、正文开始（streaming 收尾）自动收起；用户手动开合后尊重用户；
 * - 内容保留换行，max-height 220px 内滚动。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

/** 折叠态单行摘要的最大字数。 */
const BRIEF_MAX = 72;

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

  // 折叠态摘要：取第一行非空文本，超长截断（思考内容常有大量换行与缩进）
  const brief = useMemo(() => {
    const line = text
      .split('\n')
      .map((item) => item.trim())
      .find((item) => item.length > 0);
    if (!line) {
      return '';
    }
    return line.length > BRIEF_MAX ? `${line.slice(0, BRIEF_MAX)}…` : line;
  }, [text]);

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
        <span className="reasoning-block__label">{streaming ? '思考中' : '思考'}</span>
        {brief && !expanded ? (
          <>
            <span className="tool-card__sep" aria-hidden="true">
              ·
            </span>
            <span className="reasoning-block__brief">{brief}</span>
          </>
        ) : null}
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
