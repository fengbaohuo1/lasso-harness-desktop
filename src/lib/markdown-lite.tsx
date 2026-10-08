/**
 * markdown-lite（M7.3 + F5）：受控子集渲染，零依赖。
 * 支持：围栏代码块（语言标 + 复制按钮）、标题、无序/有序列表（嵌套，缩进 2 空格一级；
 * 有序列表起始序号）、GFM 表格、引用块（> 可嵌套）、分割线（---/***）、图片
 * （http/https/data:，限宽、点击不跳转）、段落、行内代码/加粗/链接/删除线。
 * 流式增量输入容错：不完整围栏/表格按普通文本渲染，不崩。
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

/** 行内格式：`code`、**bold**、![img](url)、[text](url)、~~strike~~。 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]+\]\([^)\s]+\))|(~~[^~]+~~)/g;
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
    } else if (token.startsWith('!')) {
      const m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token);
      if (m) {
        nodes.push(
          <img
            key={key}
            className="md-img"
            src={m[2]}
            alt={m[1]}
            onClick={(e) => e.preventDefault()}
          />,
        );
      } else {
        nodes.push(token);
      }
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

/** 表格行拆分：| a | b | → ['a','b']。 */
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((cell) => cell.trim());
}

const TABLE_DELIMITER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;

const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;

/** 列表项：text + 子列表（嵌套按缩进 2 空格一级）。 */
interface ListItemNode {
  text: string;
  children: ListNode[];
}

interface ListNode {
  ordered: boolean;
  start: number;
  items: ListItemNode[];
}

interface ListMatch {
  indent: number;
  ordered: boolean;
  num: number;
  text: string;
}

function matchListItem(line: string): ListMatch | null {
  const ordered = ORDERED.exec(line);
  if (ordered) {
    return {
      indent: ordered[1].replace(/\t/g, '  ').length,
      ordered: true,
      num: parseInt(ordered[2], 10),
      text: ordered[3],
    };
  }
  const bullet = BULLET.exec(line);
  if (bullet) {
    return {
      indent: bullet[1].replace(/\t/g, '  ').length,
      ordered: false,
      num: 1,
      text: bullet[2],
    };
  }
  return null;
}

/** 从 start 起解析一个列表块（同一缩进/同一类型），返回节点与下一行索引。 */
function parseListBlock(
  lines: string[],
  start: number,
  baseIndent: number,
): { node: ListNode; next: number } {
  const first = matchListItem(lines[start]);
  const node: ListNode = {
    ordered: first?.ordered ?? false,
    start: first?.num ?? 1,
    items: [],
  };
  let i = start;
  while (i < lines.length) {
    const m = matchListItem(lines[i]);
    if (!m || m.indent < baseIndent) {
      break;
    }
    if (m.indent > baseIndent) {
      // 更深缩进 → 挂到上一个条目下（容错：无宿主条目时终止本块）
      const parent = node.items[node.items.length - 1];
      if (!parent) {
        break;
      }
      const nested = parseListBlock(lines, i, m.indent);
      parent.children.push(nested.node);
      i = nested.next;
      continue;
    }
    if (m.ordered !== node.ordered) {
      break;
    }
    node.items.push({ text: m.text, children: [] });
    i += 1;
  }
  return { node, next: i };
}

function renderList(node: ListNode, key: string): ReactElement {
  const items = node.items.map((item, idx) => (
    <li key={idx}>
      {renderInline(item.text, `${key}-li${idx}`)}
      {item.children.map((child, ci) => renderList(child, `${key}-c${idx}-${ci}`))}
    </li>
  ));
  return node.ordered ? (
    <ol key={key} className="md-list md-ol" start={node.start}>
      {items}
    </ol>
  ) : (
    <ul key={key} className="md-list">
      {items}
    </ul>
  );
}

/** 引用块：连续 > 行，剥一层后递归渲染（>> 嵌套）。 */
function parseQuote(lines: string[], start: number): { inner: string[]; next: number } {
  const inner: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const m = /^\s*>\s?(.*)$/.exec(line) ?? /^\s*>(.*)$/.exec(line);
    if (!m) {
      break;
    }
    inner.push(m[1]);
    i += 1;
  }
  return { inner, next: i };
}

function renderProse(lines: string[], keyPrefix: string): ReactElement[] {
  const out: ReactElement[] = [];
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

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // GFM 表格：表头行 | 分隔行 | 数据行…
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      TABLE_DELIMITER.test(lines[i + 1]) &&
      splitTableRow(line).length > 1
    ) {
      flushParagraph();
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      i -= 1;
      out.push(
        <div key={`${keyPrefix}-t${out.length}`} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {headers.map((h, hi) => (
                  <th key={hi}>{renderInline(h, `${keyPrefix}-th${hi}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{renderInline(cell, `${keyPrefix}-td${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      out.push(
        <p key={`${keyPrefix}-h${out.length}`} className={`md-h md-h${level}`}>
          {renderInline(heading[2], `${keyPrefix}-h${out.length}`)}
        </p>,
      );
      continue;
    }

    // 分割线 --- / *** / ___（裸 --- 不会被表格/列表规则误吞）
    if (HR.test(line)) {
      flushParagraph();
      out.push(<hr key={`${keyPrefix}-hr${out.length}`} className="md-hr" />);
      continue;
    }

    // 引用块（可嵌套）
    if (/^\s*>/.test(line)) {
      flushParagraph();
      const quote = parseQuote(lines, i);
      i = quote.next - 1;
      out.push(
        <blockquote key={`${keyPrefix}-q${out.length}`} className="md-quote">
          {renderProse(quote.inner, `${keyPrefix}-q${out.length}`)}
        </blockquote>,
      );
      continue;
    }

    // 列表（嵌套 + 有序起始序号）
    const listItem = matchListItem(line);
    if (listItem) {
      flushParagraph();
      const block = parseListBlock(lines, i, listItem.indent);
      i = block.next - 1;
      out.push(renderList(block.node, `${keyPrefix}-l${out.length}`));
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }
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
