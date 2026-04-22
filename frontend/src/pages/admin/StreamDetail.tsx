/**
 * Per-stream detail / configuration page.
 *
 * Mounted at ``/admin/streams/:name``. Holds everything that used to clutter
 * the StreamsManage list: basic info form, publish secret / watch token with
 * rotate + copy buttons, push URLs (RTMP / SRT / WHIP), OBS & ffmpeg tutorial
 * snippets with copy-to-clipboard, and a dedicated low-latency-FLV guide.
 *
 * Design choices worth noting:
 *  - The publish URLs come pre-filled from the backend (see
 *    ``settings.publish_base_url`` / ``public_base_url``). When the backend
 *    hasn't been given a base URL we fall back to ``window.location.host``
 *    so admins still see something usable in a local dev setup.
 *  - All OBS / ffmpeg snippets are generated client-side via template strings
 *    that reference the *live* values of the form (so after rotating the
 *    publish secret the snippet is immediately correct without reloading).
 *  - Danger actions (delete room, rotate secret/token) use Popconfirm so
 *    there is an explicit confirmation step.
 */

import {
  ArrowLeftOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  App,
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Form,
  Input,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { streamApi } from '../../api';
import type { StreamConfig, StreamStats } from '../../types';

const { Title, Paragraph, Text } = Typography;

/** Small helper: `<pre>` code block with an inline Copy button. */
const CodeBlock: React.FC<{ code: string; lang?: string }> = ({ code, lang }) => {
  const { message } = App.useApp();
  return (
    <div style={{ position: 'relative' }}>
      <Button
        size="small"
        style={{ position: 'absolute', right: 8, top: 8, zIndex: 1 }}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            message.success('已复制');
          } catch {
            message.error('复制失败');
          }
        }}
      >
        复制
      </Button>
      <pre
        style={{
          background: '#0f172a',
          color: '#e2e8f0',
          padding: 16,
          borderRadius: 8,
          overflowX: 'auto',
          fontSize: 12,
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        {lang && <span style={{ color: '#64748b' }}># {lang}\n</span>}
        {code}
      </pre>
    </div>
  );
};

const fallbackHost = () =>
  typeof window !== 'undefined' ? window.location.host : 'your-server';

const StreamDetail: React.FC = () => {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [cfg, setCfg] = useState<StreamConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  // Live stats polled from `/api/streams/<name>/stats`. This endpoint is the
  // same one that the viewer WebSocket (`/api/viewer/ws/*`) computes against,
  // so "当前观众 / 累计观看 / 直播中" stay consistent with what actual viewers
  // see. Polling (vs opening another WS) is intentional: opening a WS from an
  // admin page would register an unwanted ViewerSession row.
  const [stats, setStats] = useState<StreamStats | null>(null);
  const statsTimerRef = useRef<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await streamApi.getConfig(name);
      setCfg(data);
      form.setFieldsValue({
        display_name: data.display_name,
        is_private: data.is_private,
        chat_enabled: data.chat_enabled,
        webrtc_play_enabled: data.webrtc_play_enabled,
      });
    } catch (e: unknown) {
      const err = e as { response?: { status?: number } };
      if (err.response?.status === 404) {
        message.error('直播间不存在');
        navigate('/admin/streams');
      } else {
        message.error('加载失败');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (name) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // Live-stats polling. Fires immediately and then every 5s while the page is
  // mounted. Errors are swallowed so a transient SRS blip doesn't stick an
  // error toast on the admin screen.
  useEffect(() => {
    if (!name) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const s = await streamApi.getStats(name);
        if (!cancelled) setStats(s);
      } catch {
        /* ignore — next tick will retry */
      }
    };

    void tick();
    statsTimerRef.current = window.setInterval(tick, 5000);
    return () => {
      cancelled = true;
      if (statsTimerRef.current !== null) {
        window.clearInterval(statsTimerRef.current);
        statsTimerRef.current = null;
      }
    };
  }, [name]);

  const save = async () => {
    if (!cfg) return;
    const v = await form.validateFields();
    setSaving(true);
    try {
      const updated = await streamApi.updateConfig(cfg.stream_name, {
        display_name: v.display_name ?? '',
        is_private: !!v.is_private,
        chat_enabled: !!v.chat_enabled,
        webrtc_play_enabled: !!v.webrtc_play_enabled,
      });
      setCfg(updated);
      message.success('已保存');
    } finally {
      setSaving(false);
    }
  };

  const rotateSecret = async () => {
    if (!cfg) return;
    const next = await streamApi.rotatePublishSecret(cfg.stream_name);
    setCfg(next);
    message.success('推流密钥已轮换');
  };

  const rotateToken = async () => {
    if (!cfg) return;
    const next = await streamApi.rotateWatchToken(cfg.stream_name);
    setCfg(next);
    message.success('观看 Token 已轮换');
  };

  const doDelete = async () => {
    if (!cfg) return;
    await streamApi.deleteConfig(cfg.stream_name);
    message.success('已删除');
    navigate('/admin/streams');
  };

  // Effective publish URLs (backend-provided when configured, local fallback
  // when ``publish_base_url`` / ``public_base_url`` are both empty).
  const urls = useMemo(() => {
    if (!cfg) return { rtmp: '', srt: '', whip: '' };
    const host = fallbackHost();
    const rtmp =
      cfg.publish_rtmp_url ||
      `rtmp://${host}/live/${cfg.stream_name}?secret=${cfg.publish_secret}`;
    const srt =
      cfg.publish_srt_url ||
      `srt://${host}:10080?streamid=#!::r=live/${cfg.stream_name},m=publish,secret=${cfg.publish_secret}`;
    const whip =
      cfg.publish_whip_url ||
      `https://${host}/rtc/v1/whip/?app=live&stream=${cfg.stream_name}&secret=${cfg.publish_secret}`;
    return { rtmp, srt, whip };
  }, [cfg]);

  if (loading && !cfg) {
    return (
      <div style={{ textAlign: 'center', padding: 64 }}>
        <Spin />
      </div>
    );
  }
  if (!cfg) return null;

  // Derive an RTMP URL + stream key split for OBS (OBS expects the two
  // fields separately).
  const obsSplit = (() => {
    // rtmp://host:port/app/stream?qs  →  server='rtmp://host:port/app',
    // key='stream?qs'.
    const m = /^(rtmp:\/\/[^/]+\/[^/]+)\/([^?]+)(\?.*)?$/.exec(urls.rtmp);
    if (!m) return { server: urls.rtmp, key: '' };
    return { server: m[1], key: `${m[2]}${m[3] ?? ''}` };
  })();

  // ffmpeg templates (x264 + AAC) for common inputs.
  const ffmpegRtmpCmd =
    `ffmpeg -re -i INPUT.mp4 \\\n` +
    `  -c:v libx264 -preset veryfast -tune zerolatency -g 30 -bf 0 \\\n` +
    `  -b:v 2500k -maxrate 2500k -bufsize 1000k \\\n` +
    `  -c:a aac -b:a 128k -ar 44100 \\\n` +
    `  -f flv "${urls.rtmp}"`;

  const ffmpegSrtCmd =
    `ffmpeg -re -i INPUT.mp4 \\\n` +
    `  -c:v libx264 -preset veryfast -tune zerolatency -g 30 -bf 0 \\\n` +
    `  -b:v 2500k -maxrate 2500k -bufsize 1000k \\\n` +
    `  -c:a aac -b:a 128k -ar 44100 \\\n` +
    `  -f mpegts "${urls.srt}"`;

  const ffmpegWhipCmd =
    `# WHIP 需要较新版本的 ffmpeg (>= 7.0) 开启 --enable-muxer=whip\n` +
    `ffmpeg -re -i INPUT.mp4 \\\n` +
    `  -c:v libx264 -preset veryfast -tune zerolatency -g 30 -bf 0 \\\n` +
    `  -c:a libopus -b:a 64k -ar 48000 -ac 2 \\\n` +
    `  -f whip "${urls.whip}"`;

  // Prefer live stats (WS-driven) over the values snapshotted on `cfg`, which
  // can lag behind if SRS hooks were dropped.
  const isLive = stats ? stats.is_live : cfg.is_live;
  const currentViewers = stats ? stats.current_viewers : cfg.viewer_count;
  const totalPlays = stats ? stats.total_plays : cfg.total_play_count;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/streams')}>
            返回
          </Button>
          <Title level={3} style={{ margin: 0 }}>
            {cfg.display_name || cfg.stream_name}
          </Title>
          {isLive ? <Tag color="green">直播中</Tag> : <Tag>离线</Tag>}
          {cfg.is_private ? <Tag color="purple">私有</Tag> : <Tag color="blue">公开</Tag>}
        </Space>
      </div>

      <Tabs
        defaultActiveKey="basic"
        items={[
          // =============================================================
          // Tab: basic info / visibility / chat / webrtc play
          // =============================================================
          {
            key: 'basic',
            label: '基本信息',
            children: (
              <Card>
                <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="流名">
                    <code>{cfg.stream_name}</code>
                  </Descriptions.Item>
                  <Descriptions.Item label="创建时间">
                    {new Date(cfg.created_at).toLocaleString()}
                  </Descriptions.Item>
                  <Descriptions.Item label="当前观众">{currentViewers}</Descriptions.Item>
                  <Descriptions.Item label="累计观看">{totalPlays}</Descriptions.Item>
                </Descriptions>

                <Form form={form} layout="vertical">
                  <Form.Item name="display_name" label="显示名称">
                    <Input placeholder="例如 我的直播间" />
                  </Form.Item>
                  <Form.Item
                    name="is_private"
                    label="私有直播"
                    valuePropName="checked"
                    extra="开启后需要登录或观看 Token 才能播放。"
                  >
                    <Switch checkedChildren="是" unCheckedChildren="否" />
                  </Form.Item>
                  <Form.Item name="chat_enabled" label="开启聊天" valuePropName="checked">
                    <Switch checkedChildren="开" unCheckedChildren="关" />
                  </Form.Item>
                  <Form.Item
                    name="webrtc_play_enabled"
                    label="允许 WebRTC(WHEP) 播放"
                    valuePropName="checked"
                    extra="关闭后本房间禁止 WHEP 拉流；WebRTC 推流 (WHIP) 不受影响。"
                  >
                    <Switch checkedChildren="允许" unCheckedChildren="禁止" />
                  </Form.Item>
                  <Space>
                    <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
                      保存
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={load}>
                      重新加载
                    </Button>
                  </Space>
                </Form>
              </Card>
            ),
          },

          // =============================================================
          // Tab: publish secret + watch token + push URLs
          // =============================================================
          {
            key: 'publish',
            label: '推流信息',
            children: (
              <Card>
                <Paragraph type="secondary">
                  以下推流地址由后端根据 <code>PUBLISH_BASE_URL</code>（若未配置则回退到
                  <code> PUBLIC_BASE_URL</code>）生成。轮换推流密钥后，旧地址立即失效。
                </Paragraph>
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="推流密钥">
                    <Space>
                      <Text code copyable={{ text: cfg.publish_secret }}>
                        {cfg.publish_secret}
                      </Text>
                      <Popconfirm title="轮换推流密钥?" onConfirm={rotateSecret}>
                        <Button size="small">重新生成</Button>
                      </Popconfirm>
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label="观看 Token (私有流)">
                    <Space>
                      <Text code copyable={{ text: cfg.watch_token }}>
                        {cfg.watch_token}
                      </Text>
                      <Popconfirm title="轮换观看 Token?" onConfirm={rotateToken}>
                        <Button size="small">重新生成</Button>
                      </Popconfirm>
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label="RTMP 推流 URL">
                    <Text code copyable>
                      {urls.rtmp}
                    </Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="SRT 推流 URL">
                    <Text code copyable>
                      {urls.srt}
                    </Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="WHIP 推流 URL">
                    <Text code copyable>
                      {urls.whip}
                    </Text>
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            ),
          },

          // =============================================================
          // Tab: OBS tutorial
          // =============================================================
          {
            key: 'obs',
            label: 'OBS 教程',
            children: (
              <Card>
                <Title level={5}>OBS 推流设置 (RTMP)</Title>
                <Paragraph>
                  打开 OBS → <b>设置</b> → <b>推流</b>：
                  <br />
                  服务选择 <b>自定义…</b>，然后填写：
                </Paragraph>
                <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="服务器 (Server)">
                    <Text code copyable>
                      {obsSplit.server}
                    </Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="串流密钥 (Stream Key)">
                    <Text code copyable>
                      {obsSplit.key}
                    </Text>
                  </Descriptions.Item>
                </Descriptions>

                <Title level={5}>输出设置（低延迟推荐）</Title>
                <Paragraph>
                  <b>设置 → 输出 → 输出模式: 高级</b>，然后在"推流"标签页：
                </Paragraph>
                <ul style={{ lineHeight: 1.9 }}>
                  <li>编码器: <b>x264</b>（或硬件编码器，选支持 zerolatency 的）</li>
                  <li>码率控制: <b>CBR</b>（稳定码率，避免 CDN 抖动）</li>
                  <li>比特率: <b>2500 Kbps</b>（1080p30 推荐 3500-4500）</li>
                  <li>关键帧间隔: <b>1s</b>（重要！默认 2s 会让延迟大 1 秒）</li>
                  <li>CPU 使用预设: <b>veryfast</b></li>
                  <li>配置 (Profile): <b>high</b></li>
                  <li>微调 (Tune): <b>zerolatency</b></li>
                  <li>B 帧: <b>0</b>（存在 B 帧会增加延迟）</li>
                </ul>

                <Title level={5}>OBS 推流 (SRT)</Title>
                <Paragraph>
                  从 OBS 28 起原生支持 SRT，仅需将 <b>服务器</b> 填为完整 SRT URL，
                  <b>串流密钥</b> 留空：
                </Paragraph>
                <CodeBlock code={urls.srt} />

                <Divider />
                <Alert
                  type="info"
                  message="WHIP (WebRTC 推流) 尚未集成在 OBS 原生界面"
                  description="若需要使用 WHIP 推流，建议改用 ffmpeg (>=7.0) 或 OBS WHIP 插件。"
                  showIcon
                />
              </Card>
            ),
          },

          // =============================================================
          // Tab: ffmpeg tutorial
          // =============================================================
          {
            key: 'ffmpeg',
            label: 'ffmpeg 教程',
            children: (
              <Card>
                <Paragraph>
                  将下面命令中的 <code>INPUT.mp4</code> 替换为你的输入源 (本地文件、设备、
                  <code>/dev/video0</code>、桌面捕获 URL 等)。
                </Paragraph>

                <Title level={5}>RTMP 推流</Title>
                <CodeBlock code={ffmpegRtmpCmd} />

                <Title level={5} style={{ marginTop: 16 }}>
                  SRT 推流
                </Title>
                <CodeBlock code={ffmpegSrtCmd} />

                <Title level={5} style={{ marginTop: 16 }}>
                  WHIP (WebRTC) 推流
                </Title>
                <CodeBlock code={ffmpegWhipCmd} />

                <Divider />
                <Paragraph type="secondary">
                  关键参数：<code>-tune zerolatency</code> 与 <code>-bf 0</code> 消除 B 帧延迟；
                  <code>-g 30</code>（30fps 时 = 1 秒）缩短 GOP；
                  <code>-preset veryfast</code> 降低编码耗时；
                  <code>-flags +low_delay</code> 启用低延迟解码路径（部分场景可加）。
                </Paragraph>
              </Card>
            ),
          },

          // =============================================================
          // Tab: low-latency FLV playback guide
          // =============================================================
          {
            key: 'latency',
            label: '低延迟方案',
            children: (
              <Card>
                <Alert
                  type="info"
                  showIcon
                  message="目标：HTTP-FLV 端到端延迟 ~1 秒"
                  description="FLV 延迟的来源主要是三处：编码器的 B 帧 / GOP、SRS 的 GOP 缓存与合并写、播放端缓冲。全部压缩到位后可以稳定在 800ms~1.2s。"
                  style={{ marginBottom: 16 }}
                />

                <Title level={5}>1. 编码端 (OBS / ffmpeg)</Title>
                <ul style={{ lineHeight: 1.9 }}>
                  <li>关键帧间隔 <b>1s</b>（GOP = 帧率）</li>
                  <li>B 帧数 = 0（<code>-bf 0</code>，OBS：高级编码器设置里设 0）</li>
                  <li>
                    <code>-tune zerolatency</code>（OBS 里是 "微调: zerolatency"）
                  </li>
                  <li>码率模式 CBR，buffer = 码率的一半或更小</li>
                  <li>使用 RTMP / SRT 推流。HLS 不适合低延迟</li>
                </ul>

                <Title level={5}>2. SRS 服务器 (Origin + Edge 都要改)</Title>
                <Paragraph>
                  在 Origin 与每一个 Edge 的 <code>srs.conf</code> 对应 vhost 下加入：
                </Paragraph>
                <CodeBlock
                  lang="srs.conf"
                  code={`tcp_nodelay on;
min_latency on;

vhost __defaultVhost__ {
  tcp_nodelay on;
  min_latency on;
  mr {
    enabled off;
  }
  mw_latency 100;

  publish {
    mr off;
    firstpkt_timeout 20000;
    normal_timeout   7000;
    parse_sps on;
  }

  play {
    gop_cache off;
    queue_length 10;
    mw_latency 100;
    atc off;
    mix_correct on;
  }
}`}
                />
                <Paragraph type="secondary">
                  <b>gop_cache off</b> 会让首帧稍慢（需要等下一个关键帧），但延迟会小 0.5~1 秒；
                  <b> mw_latency</b> 是 merge-write 最大等待时间（ms），越小延迟越低但小包会更多。
                </Paragraph>

                <Title level={5}>3. 播放端 (flv.js / mpegts.js)</Title>
                <Paragraph>项目前端已内置这些参数；自行集成时请使用：</Paragraph>
                <CodeBlock
                  lang="mpegts.js config"
                  code={`{
  enableWorker: true,
  enableStashBuffer: false,
  stashInitialSize: 128,
  liveBufferLatencyChasing: true,
  liveBufferLatencyMaxLatency: 1.2,
  liveBufferLatencyMinRemain: 0.3,
  autoCleanupSourceBuffer: true,
  autoCleanupMaxBackwardDuration: 3,
  autoCleanupMinBackwardDuration: 2
}`}
                />

                <Title level={5}>4. 传输 / 部署</Title>
                <ul style={{ lineHeight: 1.9 }}>
                  <li>Nginx 反代启用 <code>proxy_buffering off;</code>（针对 .flv 路径）</li>
                  <li>开启 TCP <b>keepalive</b> 与 <code>tcp_nodelay on</code></li>
                  <li>CDN 若需低延迟，选支持 "流式回源" 的厂商；HLS / DASH 回源会引入 5s+ 延迟</li>
                </ul>

                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 16 }}
                  message="Edge 节点也要配置!"
                  description="以上 SRS 参数在 Origin 与 Edge 上必须保持一致，否则最慢的一端会决定整体延迟。参考仓库 deploy/srs-edge.conf 模板。"
                />
              </Card>
            ),
          },

          // =============================================================
          // Tab: danger zone (delete room)
          // =============================================================
          {
            key: 'danger',
            label: '危险操作',
            children: (
              <Card>
                <Alert
                  type="error"
                  showIcon
                  message="删除直播间"
                  description="删除后推流密钥、观看 Token、聊天配置都会一并清除；历史统计记录会保留。"
                  style={{ marginBottom: 16 }}
                />
                <Popconfirm
                  title="确认删除?"
                  description="此操作不可撤销。"
                  okText="确认删除"
                  okButtonProps={{ danger: true }}
                  onConfirm={doDelete}
                >
                  <Button danger icon={<DeleteOutlined />}>
                    删除此直播间
                  </Button>
                </Popconfirm>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
};

export default StreamDetail;
