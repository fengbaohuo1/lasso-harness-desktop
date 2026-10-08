/**
 * 关于页（F4）：应用版本 + 内核版本（/actuator/info，有则显示）+ 已加载插件数 +
 * 快捷键一览 + 项目说明。
 */

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { fetchKernelInfo } from '../lib/agent-client';
import { listPlugins } from '../lib/settings-client';
import { APP_VERSION } from '../types';

const SHORTCUTS: Array<[string, string]> = [
  ['Enter', '发送消息（生成中禁用，可先输入排队）'],
  ['Shift + Enter', '换行'],
  ['Ctrl + N', '新对话'],
  ['Ctrl + ,', '打开/关闭设置'],
  ['Esc', '关闭弹层；生成中且无弹层时停止生成'],
  ['↑ / ↓', '在输入框顶部/底部召回历史草稿'],
];

export default function AboutPanel(): ReactElement {
  const [kernelVersion, setKernelVersion] = useState<string | null>(null);
  const [pluginCount, setPluginCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchKernelInfo().then((version) => {
      if (!cancelled) {
        setKernelVersion(version);
      }
    });
    void listPlugins()
      .then((plugins) => {
        if (!cancelled) {
          setPluginCount(plugins.length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPluginCount(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="about">
      <h3 className="about__title">jnf-harness Desktop</h3>
      <p className="about__desc">
        自有 Agent Harness 桌面壳：Tauri 托管内嵌 jnf-harness 服务，对话驱动工具调用，
        运行期审批、会话事件回放、厂商模型渠道与插件管理一站配齐。
      </p>
      <dl className="about__grid">
        <dt>应用版本</dt>
        <dd>
          {APP_VERSION}
          <span className="badge badge--muted">来源：tauri.conf.json</span>
        </dd>
        {kernelVersion ? (
          <>
            <dt>内核版本</dt>
            <dd>{kernelVersion}</dd>
          </>
        ) : null}
        {pluginCount !== null ? (
          <>
            <dt>已加载插件</dt>
            <dd>{pluginCount} 个</dd>
          </>
        ) : null}
      </dl>
      <h4>快捷键</h4>
      <table className="about__shortcuts">
        <tbody>
          {SHORTCUTS.map(([keys, description]) => (
            <tr key={keys}>
              <td>{keys}</td>
              <td>{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>项目说明</h4>
      <p className="about__desc">
        jnf-harness 是 DDD 六边形架构的 Java Agent Harness：ReAct 循环 + 会话事件溯源 +
        三通道插件（Java SPI / Node Bridge / MCP）+ 运行期审批治理。桌面端与内核通过
        127.0.0.1 HTTP/SSE 通信，数据与密钥仅存本机。
      </p>
    </div>
  );
}
