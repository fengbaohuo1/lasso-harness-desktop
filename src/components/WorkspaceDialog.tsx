/**
 * 工作区新建/编辑对话框（P10-5）。
 * - 名称 + 根目录；根目录可「浏览」——走后端 `GET /api/harness/workspaces/browse`（只列子目录），
 *   免手打绝对路径（本项目 Tauri 侧未装 dialog 插件，不做原生目录选择器）。
 * - 浏览面板：盘符/根快速跳转 → 逐级进入 → 「使用此目录」回填。
 * - 新建 = POST /api/harness/workspaces；编辑 = PUT /{code}（default 也可改名/改根）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { BrowseChild, WorkspaceItem } from '../types';
import { browseDirectories, createWorkspace, updateWorkspace } from '../lib/settings-client';
import { toast } from '../lib/toast';
import { CloseIcon, FolderUpIcon, WorkspaceIcon } from './icons';

interface Props {
  /** 传入则编辑该工作区；缺省为新建。 */
  target?: WorkspaceItem | null;
  onClose: () => void;
  onSaved: (item: WorkspaceItem) => void;
}

export default function WorkspaceDialog({ target, onClose, onSaved }: Props): ReactElement {
  const isEdit = Boolean(target);
  const [displayName, setDisplayName] = useState(target?.displayName ?? '');
  const [rootPath, setRootPath] = useState(target?.rootPath ?? '');
  const [browsing, setBrowsing] = useState(false);
  const [listing, setListing] = useState<{ path: string; parent: string | null; roots: string[]; directories: BrowseChild[]; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const load = useCallback(async (path: string | null): Promise<void> => {
    try {
      const result = await browseDirectories(path);
      setListing(result);
    } catch (err) {
      setListing({
        path: path ?? '',
        parent: null,
        roots: [],
        directories: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const openBrowser = async (): Promise<void> => {
    setBrowsing(true);
    await load(rootPath.trim() || null);
  };

  const handleSave = async (): Promise<void> => {
    const name = displayName.trim();
    const root = rootPath.trim();
    if (!name) {
      toast('请填写工作区名称');
      nameRef.current?.focus();
      return;
    }
    if (!root) {
      toast('请填写或选择根目录');
      return;
    }
    setBusy(true);
    try {
      const saved = isEdit && target
        ? await updateWorkspace(target.workspaceCode, { displayName: name, rootPath: root })
        : await createWorkspace({ displayName: name, rootPath: root });
      toast(isEdit ? `工作区「${saved.displayName}」已更新` : `工作区「${saved.displayName}」已创建`);
      onSaved(saved);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-overlay" onMouseDown={onClose}>
      <div
        className="ws-dialog"
        role="dialog"
        aria-label={isEdit ? '编辑工作区' : '新建工作区'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ws-dialog__head">
          <span className="ws-dialog__icon">
            <WorkspaceIcon />
          </span>
          <h2>{isEdit ? '编辑工作区' : '新建工作区'}</h2>
          <button type="button" className="icon-btn" title="关闭" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="ws-dialog__body">
          <label className="ws-field">
            <span className="ws-field__label">名称</span>
            <input
              ref={nameRef}
              value={displayName}
              disabled={busy}
              placeholder="如 jnf-desktop"
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>

          <label className="ws-field">
            <span className="ws-field__label">根目录</span>
            <div className="ws-field__row">
              <input
                value={rootPath}
                disabled={busy}
                placeholder="绝对路径，如 D:\study\dsh-java"
                onChange={(e) => setRootPath(e.target.value)}
              />
              <button
                type="button"
                className={`btn btn--small${browsing ? ' btn--primary' : ''}`}
                disabled={busy}
                onClick={() => void (browsing ? setBrowsing(false) : openBrowser())}
              >
                {browsing ? '收起' : '浏览'}
              </button>
            </div>
            <small className="ws-field__hint">
              会话的 cwd 与沙箱工作区根都取这里；目录不存在时后端会自动创建。
            </small>
          </label>

          {browsing ? (
            <div className="ws-browser">
              <div className="ws-browser__bar">
                <button
                  type="button"
                  className="icon-btn"
                  title="上级目录"
                  disabled={!listing?.parent}
                  onClick={() => void load(listing?.parent ?? null)}
                >
                  <FolderUpIcon />
                </button>
                <code className="ws-browser__path" title={listing?.path ?? ''}>
                  {listing?.path ?? '读取中…'}
                </code>
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  disabled={!listing?.path || Boolean(listing.error)}
                  onClick={() => {
                    if (listing?.path) {
                      setRootPath(listing.path);
                      setBrowsing(false);
                    }
                  }}
                >
                  使用此目录
                </button>
              </div>

              {listing && listing.roots.length > 1 ? (
                <div className="ws-browser__roots">
                  {listing.roots.map((root) => (
                    <button
                      key={root}
                      type="button"
                      className="chip chip--ghost"
                      onClick={() => void load(root)}
                    >
                      {root}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="ws-browser__list">
                {listing?.error ? (
                  <p className="ws-browser__empty">{listing.error}</p>
                ) : listing && listing.directories.length > 0 ? (
                  listing.directories.map((child) => (
                    <button
                      key={child.path}
                      type="button"
                      className="ws-browser__item"
                      title={child.path}
                      onClick={() => void load(child.path)}
                    >
                      <span className="ws-browser__item-icon">
                        <WorkspaceIcon />
                      </span>
                      <span className="ws-browser__item-name">{child.name}</span>
                    </button>
                  ))
                ) : listing ? (
                  <p className="ws-browser__empty">该目录下没有子目录</p>
                ) : (
                  <p className="ws-browser__empty">读取中…</p>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <footer className="ws-dialog__foot">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void handleSave()}>
            {isEdit ? '保存' : '创建'}
          </button>
        </footer>
      </div>
    </div>
  );
}
