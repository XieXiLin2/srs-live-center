import {
  EyeOutlined,
  KeyOutlined,
  LockOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  message,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { streamApi } from '../api';
import ChatPanel from '../components/ChatPanel';
import LivePlayer from '../components/LivePlayer';
import { useAuth } from '../store/auth';
import type { StreamInfo, StreamPlayResponse, StreamStats } from '../types';

function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds < 0) return '0s';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const { Title, Text } = Typography;

const Home: React.FC = () => {
  const { user, token: authToken, login } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStream, setSelectedStream] = useState<StreamInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string>('flv');
  const [playData, setPlayData] = useState<StreamPlayResponse | null>(null);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [watchToken, setWatchToken] = useState('');
  const [stats, setStats] = useState<StreamStats | null>(null);
  // Ticks every second so the "已开播时长" display smoothly advances between
  // server stats pushes, instead of jumping in big steps.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const viewerWsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Optional deep link: /?room=<stream_name>&token=<watch_token>
  const initialRoom = searchParams.get('room') || '';
  const initialToken = searchParams.get('token') || '';

  const fetchStreams = useCallback(async () => {
    setLoading(true);
    try {
      const data = await streamApi.list();
      setStreams(data.streams);
      return data.streams;
    } catch (err) {
      console.error('Failed to fetch streams:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStreams();
    const interval = setInterval(fetchStreams, 15000);
    return () => clearInterval(interval);
  }, [fetchStreams]);

  // Subscribe to per-stream statistics over a dedicated WebSocket.
  //
  // The backend owns playback analytics entirely (see routers/viewer.py): it
  // increments/decrements current_viewers based on this very WS connection,
  // sweeps zombie sessions via heartbeat timeouts, and pushes a fresh
  // `{type:"stats", ...}` snapshot whenever counts change. The frontend does
  // **not** poll `/stats` anymore.
  useEffect(() => {
    if (!selectedStream) {
      setStats(null);
      // Close any previous viewer WS when leaving the room.
      if (viewerWsRef.current) {
        try {
          viewerWsRef.current.close();
        } catch {
          /* ignore */
        }
        viewerWsRef.current = null;
      }
      return;
    }

    const stream = selectedStream;
    let closedByUs = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // Resolve the token the backend expects for room access.
    //
    // We always prefer the user's JWT when they're logged in — even for
    // public rooms — so the ViewerSession is attributed to their user_id
    // (otherwise the admin "viewer sessions" page would show them as 游客).
    // For non-logged-in viewers of a private room, fall back to the
    // ?token=<watch_token> deep-link param.
    const resolveTokenForRoom = (): string => {
      if (authToken) return authToken;
      if (stream.is_private) return searchParams.get('token') || '';
      return '';
    };

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const tok = resolveTokenForRoom();
      const qs = tok ? `?token=${encodeURIComponent(tok)}` : '';
      const wsUrl = `${protocol}//${window.location.host}/api/viewer/ws/${stream.name}${qs}`;

      const ws = new WebSocket(wsUrl);
      viewerWsRef.current = ws;

      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === 'stats') {
          // Strip the `type` field; the rest matches the StreamStats shape.
          const { type: _t, ...rest } = msg as unknown as StreamStats & { type: string };
          void _t;
          setStats(rest as StreamStats);
        }
      };

      ws.onopen = () => {
        // Clear any pending reconnect attempt.
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        // Heartbeat every 15s so the backend keeps our ViewerSession alive.
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'ping' }));
            } catch {
              /* ignore */
            }
          }
        }, 15000);
      };

      ws.onclose = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (closedByUs) return;
        // Try to reconnect after a short delay so stats keep flowing if the
        // backend bounces or the network blips.
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        // onclose will handle reconnect.
      };
    };

    connect();

    return () => {
      closedByUs = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (viewerWsRef.current) {
        try {
          viewerWsRef.current.close();
        } catch {
          /* ignore */
        }
        viewerWsRef.current = null;
      }
    };
  }, [selectedStream, authToken, searchParams]);

  const handlePlay = useCallback(
    async (stream: StreamInfo, format: string, token?: string) => {
      if (stream.is_private && !user && !token) {
        // Need either login or token.
        setSelectedStream(stream);
        setSelectedFormat(format);
        setTokenModalOpen(true);
        return;
      }

      try {
        const data = await streamApi.play(stream.name, format, token);
        setPlayData(data);
        setSelectedStream(stream);
        setSelectedFormat(format);
        setTokenModalOpen(false);
        setWatchToken('');
        // Sync URL.
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set('room', stream.name);
          if (token) next.set('token', token);
          else next.delete('token');
          return next;
        });
      } catch (err: unknown) {
        const error = err as { response?: { status?: number; data?: { detail?: string } } };
        if (error.response?.status === 401) {
          if (!user) {
            message.warning('此直播需要登录或有效的观看 Token');
            setTokenModalOpen(true);
            return;
          }
          message.error('鉴权失败');
        } else {
          message.error(error.response?.data?.detail || '获取播放地址失败');
        }
      }
    },
    [user, setSearchParams],
  );

  const handleTokenSubmit = () => {
    if (selectedStream) {
      handlePlay(selectedStream, selectedFormat, watchToken);
    }
  };

  const selectStream = useCallback(
    (stream: StreamInfo, token?: string) => {
      const fmt = stream.formats.includes('flv') ? 'flv' : stream.formats[0] || 'flv';
      setSelectedFormat(fmt);
      handlePlay(stream, fmt, token);
    },
    [handlePlay],
  );

  // Auto-play from URL params after streams load.
  useEffect(() => {
    if (!initialRoom || selectedStream || streams.length === 0) return;
    const match = streams.find((s) => s.name === initialRoom);
    if (match) selectStream(match, initialToken || undefined);
  }, [initialRoom, initialToken, streams, selectedStream, selectStream]);

  const publicStreams = useMemo(() => streams.filter((s) => !s.is_private), [streams]);
  const privateStreams = useMemo(() => streams.filter((s) => s.is_private), [streams]);

  const renderStreamCard = (stream: StreamInfo) => (
    <Col xs={24} sm={12} md={8} lg={6} key={stream.name}>
      <Card
        hoverable
        onClick={() => selectStream(stream)}
        styles={{ body: { padding: 16 } }}
        style={{
          border: selectedStream?.name === stream.name ? '2px solid #1677ff' : undefined,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <VideoCameraOutlined
            style={{ fontSize: 20, color: stream.is_live ? '#f5222d' : '#bfbfbf', marginRight: 8 }}
          />
          <Text strong ellipsis style={{ flex: 1 }}>
            {stream.display_name}
          </Text>
        </div>
        <Space wrap size={4}>
          {stream.is_live ? <Tag color="red">LIVE</Tag> : <Tag>离线</Tag>}
          <Tag icon={<EyeOutlined />}>{stream.clients}</Tag>
          {stream.is_private && (
            <Tag icon={<LockOutlined />} color="purple">
              私有
            </Tag>
          )}
          {!stream.chat_enabled && <Tag>弹幕关闭</Tag>}
        </Space>
        <div style={{ marginTop: 8 }}>
          {stream.formats.map((f) => (
            <Tag key={f} style={{ fontSize: 11 }}>
              {f.toUpperCase()}
            </Tag>
          ))}
        </div>
      </Card>
    </Col>
  );

  return (
    <div>
      {/* Player area */}
      {playData && selectedStream ? (
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col xs={24} lg={16}>
            <Card
              title={
                <Space>
                  <VideoCameraOutlined />
                  <span>{selectedStream.display_name}</span>
                  {selectedStream.is_live && <Tag color="red">LIVE</Tag>}
                  {selectedStream.is_private && (
                    <Tag icon={<LockOutlined />} color="purple">
                      私有
                    </Tag>
                  )}
                </Space>
              }
              extra={
                <Space>
                  <Select
                    value={selectedFormat}
                    onChange={(fmt) => handlePlay(selectedStream, fmt, initialToken || undefined)}
                    style={{ width: 110 }}
                    options={selectedStream.formats.map((f) => ({
                      label: f.toUpperCase(),
                      value: f,
                    }))}
                  />
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => handlePlay(selectedStream, selectedFormat, initialToken || undefined)}
                    size="small"
                  >
                    刷新
                  </Button>
                </Space>
              }
              styles={{ body: { padding: 0 } }}
            >
              <LivePlayer url={playData.url} format={selectedFormat} />
              <div style={{ padding: '8px 16px' }}>
                <Space wrap>
                  <Text type="secondary">
                    <EyeOutlined /> {stats?.current_viewers ?? selectedStream.clients} 观众
                  </Text>
                  {stats && (
                    <>
                      <Text type="secondary">峰值 {stats.peak_session_viewers}</Text>
                      {stats.is_live && stats.current_session_started_at ? (
                        <Text type="secondary">
                          已开播{' '}
                          {formatDuration(
                            // Smoothly advance with the 1s `nowTick` instead of
                            // waiting for the next 10s poll. Fall back to the
                            // server-reported value on clock skew.
                            Math.max(
                              stats.current_live_duration_seconds,
                              Math.floor(
                                (nowTick -
                                  new Date(stats.current_session_started_at).getTime()) /
                                  1000,
                              ),
                            ),
                          )}
                        </Text>
                      ) : (
                        <Text type="secondary">未开播</Text>
                      )}
                      <Text type="secondary">累计 {stats.total_plays} 次观看</Text>
                    </>
                  )}
                  {selectedStream.video_codec && <Tag>{selectedStream.video_codec}</Tag>}
                  {selectedStream.audio_codec && <Tag>{selectedStream.audio_codec}</Tag>}
                  <Tag color="blue">{selectedFormat.toUpperCase()}</Tag>
                </Space>
              </div>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <div style={{ height: 500 }}>
              <ChatPanel streamName={selectedStream.name} />
            </div>
          </Col>
        </Row>
      ) : (
        !loading &&
        streams.length > 0 && (
          <Alert message="选择一个直播间开始观看" type="info" showIcon style={{ marginBottom: 16 }} />
        )
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          <PlayCircleOutlined /> 直播间
        </Title>
        <Button icon={<ReloadOutlined />} onClick={fetchStreams} loading={loading}>
          刷新
        </Button>
      </div>

      {loading && streams.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" />
        </div>
      ) : streams.length === 0 ? (
        <Empty description="暂无直播间" />
      ) : (
        <>
          {publicStreams.length > 0 && (
            <>
              <Title level={5} style={{ marginTop: 8 }}>
                公开直播
              </Title>
              <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                {publicStreams.map(renderStreamCard)}
              </Row>
            </>
          )}
          {privateStreams.length > 0 && (
            <>
              <Title level={5}>
                <LockOutlined /> 私有直播
              </Title>
              <Row gutter={[16, 16]}>{privateStreams.map(renderStreamCard)}</Row>
            </>
          )}
        </>
      )}

      {/* Token input modal for private streams */}
      <Modal
        title={
          <Space>
            <LockOutlined /> 观看私有直播
          </Space>
        }
        open={tokenModalOpen}
        onOk={handleTokenSubmit}
        onCancel={() => {
          setTokenModalOpen(false);
          setWatchToken('');
        }}
        okText="使用 Token 观看"
        cancelText="取消"
        footer={[
          <Button key="login" icon={<KeyOutlined />} onClick={login}>
            登录观看
          </Button>,
          <Button
            key="submit"
            type="primary"
            onClick={handleTokenSubmit}
            disabled={!watchToken.trim()}
          >
            使用 Token 观看
          </Button>,
        ]}
      >
        <Alert
          type="info"
          showIcon
          message="此直播为私有直播，需要登录账号或持有观看 Token 才能播放。"
          style={{ marginBottom: 12 }}
        />
        <Input.Password
          value={watchToken}
          onChange={(e) => setWatchToken(e.target.value)}
          placeholder="请输入观看 Token"
          onPressEnter={handleTokenSubmit}
        />
      </Modal>
    </div>
  );
};

export default Home;
