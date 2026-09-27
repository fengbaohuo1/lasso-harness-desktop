/**
 * markdown-lite（M7.3）：受控子集渲染，零依赖。
 * 支持：围栏代码块（语言标 + 复制按钮）、标题、无序/有序列表、段落、
 * 行内代码、加粗、链接。不引 react-markdown——聊天文本子集足够，避免依赖面。
 */

import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

function CopyButton({ text }: { text: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    const done = (): void => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  };
  return (
    <button type="button" className="copy-btn" onClick={copy}>
      {copied ? '已复制' : '复制'}
    </button>
  );
}

function fallbackCopy(text: string, done: () => void): void {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  try {
    document.execCommand('copy');
    done();
  } catch {
    /* 剪贴板不可用时静默 */
  }
  document.body.removeChild(el);
}

/** 行内格式：`code`、**bold**、[text](url)、~~strike~~。 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(~~[^~]+~~)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-i${i++}`;
    if (token.startsWith('`')) {
      nodes.push(<code key={key} className="md-code">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>);
    } else {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (m) {
        nodes.push(
          <a key={key} href={m[2]} target="_blank" rel="noreferrer">
            {m[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}

function renderProse(lines: string[], keyPrefix: string): ReactElement[] {
  const out: ReactElement[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      out.push(
        <p key={`${keyPrefix}-p${out.length}`} className="md-p">
          {paragraph.map((line, idx) => (
            <span key={idx}>
              {idx > 0 ? <br /> : null}
              {renderInline(line, `${keyPrefix}-p${out.length}-${idx}`)}
            </span>
          ))}
        </p>,
      );
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (list) {
      const items = list.items.map((item, idx) => (
        <li key={idx}>{renderInline(item, `${keyPrefix}-li${idx}`)}</li>
      ));
      out.push(
        list.ordered ? (
          <ol key={`${keyPrefix}-ol${out.length}`} className="md-list">
            {items}
          </ol>
        ) : (
          <ul key={`${keyPrefix}-ul${out.length}`} className="md-list">
            {items}
          </ul>
        ),
      );
      list = null;
    }
  };

  for (const line of lines) {
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      out.push(
        <p key={`${keyPrefix}-h${out.length}`} className={`md-h md-h${level}`}>
          {renderInline(heading[2], `${keyPrefix}-h${out.length}`)}
        </p>,
      );
    } else if (bullet || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((bullet ? bullet[1] : ordered![1]).trim());
    } else if (line.trim() === '') {
      flushList();
      flushParagraph();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushList();
  flushParagraph();
  return out;
}

/** 围栏代码块。 */
function CodeBlock({ code, language }: { code: string; language: string }): ReactElement {
  return (
    <div className="md-fence">
      <div className="md-fence__head">
        <span className="md-fence__lang">{language || 'text'}</span>
        <CopyButton text={code} />
      </div>
      <pre className="md-fence__pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function MarkdownLite({ text }: { text: string }): ReactElement {
  const segments: ReactElement[] = [];
  const fence = /```([a-zA-Z0-9+#-]*)\r?\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = fence.exec(text)) !== null) {
    if (match.index > last) {
      segments.push(...renderProse(text.slice(last, match.index).split(/\r?\n/), `s${i}`));
    }
    segments.push(<CodeBlock key={`f${i}`} language={match[1]} code={match[2].replace(/\n$/, '')} />);
    last = match.index + match[0].length;
    i += 1;
  }
  if (last < text.length) {
    segments.push(...renderProse(text.slice(last).split(/\r?\n/), `s${i}`));
  }
  return <div className="markdown-lite">{segments}</div>;
}
