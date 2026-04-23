import {
  EyeOutlined,
  LockOutlined,
  ReloadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  message,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { edgeApi, streamApi } from '../api';
import ChatPanel from '../components/ChatPanel';
import LivePlayer from '../components/LivePlayer';
import { useAuth } from '../store/auth';
import { usePageTitle } from '../store/branding';
import type { PlaybackSources, StreamInfo, StreamPlayResponse, StreamStats } from '../types';

const { Text } = Typography;

function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds < 0) return '0s';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const LiveRoom: React.FC = () => {
  const { roomname } = useParams<{ roomname: string }>();
  const navigate = useNavigate();
  const { token: authToken } = useAuth();
  const [stream, setStream] = useState<StreamInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFormat, setSelectedFormat] = useState<string>('flv');
  const [playData, setPlayData] = useState<StreamPlayResponse | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [sources, setSources] = useState<PlaybackSources | null>(null);
  const [selectedSource, setSelectedSource] = useState<string>('origin');
  const viewerWsRef = useRef<WebSocket | null>(null);

  // Track live session for duration calculation
  const [liveStartTime, setLiveStartTime] = useState<number | null>(null);
  const [lastLiveDuration, setLastLiveDuration] = useState<number>(0);
  const [currentLiveDuration, setCurrentLiveDuration] = useState<number>(0);

  usePageTitle(stream ? stream.display_name : '直播间');

  // Load playback sources
  useEffect(() => {
    edgeApi
      .listPlaybackSources()
      .then(setSources)
      .catch((e) => console.warn('failed to load playback sources', e));
  }, []);

  // Load stream info
  const loadStream = useCallback(async () => {
    if (!roomname) return;
    setLoading(true);
    try {
      const data = await streamApi.list();
      const found = data.streams.find((s) => s.name === roomname);
      if (!found) {
        message.error('直播间不存在');
        navigate('/');
        return;
      }
      setStream(found);
      return found;
    } catch (err) {
      console.error('Failed to fetch stream:', err);
      message.error('加载直播间失败');
    } finally {
      setLoading(false);
    }
  }, [roomname, navigate]);

  useEffect(() => {
    loadStream();
  }, [loadStream]);

  // Auto-play when stream loads
  useEffect(() => {
    if (!stream || playData) return;
    const fmt = stream.formats.includes('flv') ? 'flv' : stream.formats[0] || 'flv';
    setSelectedFormat(fmt);
    handlePlay(stream, fmt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  // Track live session duration
  useEffect(() => {
    if (stats?.is_live && !liveStartTime) {
      // Just went live
      setLiveStartTime(Date.now());
      setLastLiveDuration(0);
    } else if (!stats?.is_live && liveStartTime) {
      // Just went offline
      setLastLiveDuration(Math.floor((Date.now() - liveStartTime) / 1000));
      setLiveStartTime(null);
    }
  }, [stats?.is_live, liveStartTime]);

  // Update current live duration every second
  useEffect(() => {
    if (!liveStartTime) return;
    const timer = setInterval(() => {
      setCurrentLiveDuration(Math.floor((Date.now() - liveStartTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [liveStartTime]);

  // Subscribe to viewer stats WebSocket
  useEffect(() => {
    if (!stream) {
      setStats(null);
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

    let closedByUs = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const resolveTokenForRoom = (): string => {
      if (authToken) return authToken;
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
          const { type: _t, ...rest } = msg as unknown as StreamStats & { type: string };
          void _t;
          setStats(rest as StreamStats);
        }
      };

      ws.onopen = () => {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
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
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        // onclose will handle reconnect
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
  }, [stream, authToken]);

  const handlePlay = useCallback(
    async (streamInfo: StreamInfo, format: string) => {
      try {
        const data = await streamApi.play(streamInfo.name, format);
        setPlayData(data);
        setSelectedFormat(format);
      } catch (err: unknown) {
        const error = err as { response?: { status?: number; data?: { detail?: string } } };
        if (error.response?.status === 401) {
          message.error('需要登录或有效的观看 Token');
        } else {
          message.error(error.response?.data?.detail || '获取播放地址失败');
        }
      }
    },
    [],
  );

  const resolvedPlayUrl = useMemo(() => {
    if (!playData?.url) return '';
    if (!sources || selectedSource === 'origin') return playData.url;
    const edge = sources.edges.find((e) => e.slug === selectedSource);
    if (!edge || !edge.base_url) return playData.url;
    // Apply edge rewrite
    if (/^https?:\/\//i.test(playData.url)) {
      try {
        const u = new URL(playData.url);
        const eb = new URL(edge.base_url);
        return `${eb.origin}${u.pathname}${u.search}${u.hash}`;
      } catch {
        return playData.url;
      }
    }
    try {
      const eb = new URL(edge.base_url);
      const path = playData.url.startsWith('/') ? playData.url : `/${playData.url}`;
      return `${eb.origin}${path}`;
    } catch {
      return playData.url;
    }
  }, [playData, sources, selectedSource]);

  const sourceOptions = useMemo(() => {
    const opts: { label: string; value: string }[] = [{ label: 'Origin', value: 'origin' }];
    if (sources) {
      sources.edges.forEach((e) => opts.push({ label: e.name, value: e.slug }));
    }
    return opts;
  }, [sources]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!stream) {
    return (
      <Alert message="直播间不存在" type="error" showIcon style={{ marginBottom: 16 }} />
    );
  }

  return (
    <div>
      <Row gutter={16}>
        <Col xs={24} lg={16}>
          <Card
            title={
              <Space>
                <VideoCameraOutlined />
                <span>{stream.display_name}</span>
                {stream.is_live && <Tag color="red">LIVE</Tag>}
                {stream.is_private && (
                  <Tag icon={<LockOutlined />} color="purple">
                    私有
                  </Tag>
                )}
              </Space>
            }
            extra={
              <Space>
                {sourceOptions.length > 1 && (
                  <Select
                    value={selectedSource}
                    onChange={setSelectedSource}
                    style={{ width: 160 }}
                    options={sourceOptions}
                  />
                )}
                <Select
                  value={selectedFormat}
                  onChange={(fmt) => handlePlay(stream, fmt)}
                  style={{ width: 110 }}
                  options={stream.formats.map((f) => ({
                    label: f.toUpperCase(),
                    value: f,
                  }))}
                />
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => handlePlay(stream, selectedFormat)}
                  size="small"
                >
                  刷新
                </Button>
              </Space>
            }
            styles={{ body: { padding: 0 } }}
          >
            <LivePlayer
              url={resolvedPlayUrl || playData?.url || ''}
              format={selectedFormat}
              isLive={stream.is_live}
              placeholderUrl={stream.offline_placeholder_url}
            />

            <div style={{ padding: '8px 16px' }}>
              <Space wrap>
                <Text type="secondary">
                  <EyeOutlined /> {stats?.current_viewers ?? stream.clients} 观众
                </Text>
                {stats && stream.is_live && (
                  <>
                    <Text type="secondary">峰值 {stats.peak_session_viewers}</Text>
                    <Text type="secondary">
                      已开播 {formatDuration(currentLiveDuration)}
                    </Text>
                    <Text type="secondary">累计 {stats.total_plays} 次观看</Text>
                  </>
                )}
                {stats && !stream.is_live && lastLiveDuration > 0 && (
                  <Text type="secondary">
                    上次播了 {formatDuration(lastLiveDuration)}
                  </Text>
                )}
                {stream.video_codec && <Tag>{stream.video_codec}</Tag>}
                {stream.audio_codec && <Tag>{stream.audio_codec}</Tag>}
                <Tag color="blue">{selectedFormat.toUpperCase()}</Tag>
              </Space>
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <div style={{ height: 500 }}>
            <ChatPanel streamName={stream.name} />
          </div>
        </Col>
      </Row>
    </div>
  );
};

export default LiveRoom;
