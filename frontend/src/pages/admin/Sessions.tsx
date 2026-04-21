import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Button,
  DatePicker,
  Input,
  InputNumber,
  message,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import React, { useCallback, useEffect, useState } from 'react';

// antd's RangePicker uses dayjs under the hood but doesn't re-export its types.
// We only ever call `.toISOString()` on the values, so this minimal shape is
// enough and avoids adding a direct dayjs dependency.
type DateLike = { toISOString: () => string };
import { adminApi } from '../../api';
import type {
  StreamPlaySessionItem,
  StreamPublishSessionItem,
  ViewerSessionItem,
  ViewerSessionsQuery,
} from '../../types';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const fmtDuration = (s: number) => {
  if (!s) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
};

const Sessions: React.FC = () => {
  // --- Legacy (SRS hook) tables ---
  const [filter, setFilter] = useState('');
  const [plays, setPlays] = useState<StreamPlaySessionItem[]>([]);
  const [pubs, setPubs] = useState<StreamPublishSessionItem[]>([]);
  const [loadingLegacy, setLoadingLegacy] = useState(false);

  const loadLegacy = useCallback(async () => {
    setLoadingLegacy(true);
    try {
      const [p, pb] = await Promise.all([
        adminApi.getPlaySessions(filter, 200, 0),
        adminApi.getPublishSessions(filter, 200, 0),
      ]);
      setPlays(p);
      setPubs(pb);
    } finally {
      setLoadingLegacy(false);
    }
  }, [filter]);

  useEffect(() => {
    loadLegacy();
  }, [loadLegacy]);

  // --- Viewer sessions (WS-driven, primary history) ---
  const [vFilter, setVFilter] = useState('');
  const [vUserId, setVUserId] = useState<number | undefined>(undefined);
  const [vRange, setVRange] = useState<[DateLike | null, DateLike | null] | null>(null);
  const [vOnlyEnded, setVOnlyEnded] = useState(false);
  const [vPage, setVPage] = useState(1);
  const [vPageSize, setVPageSize] = useState(50);
  const [viewerRows, setViewerRows] = useState<ViewerSessionItem[]>([]);
  const [viewerTotal, setViewerTotal] = useState(0);
  const [loadingViewer, setLoadingViewer] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  const buildViewerQuery = useCallback(
    (overrides?: Partial<ViewerSessionsQuery>): ViewerSessionsQuery => {
      const q: ViewerSessionsQuery = {};
      if (vFilter) q.stream_name = vFilter;
      if (vUserId) q.user_id = vUserId;
      if (vRange?.[0]) q.started_after = vRange[0].toISOString();
      if (vRange?.[1]) q.started_before = vRange[1].toISOString();
      if (vOnlyEnded) q.only_ended = true;
      return { ...q, ...overrides };
    },
    [vFilter, vUserId, vRange, vOnlyEnded],
  );

  const loadViewer = useCallback(
    async (page = vPage, pageSize = vPageSize) => {
      setLoadingViewer(true);
      try {
        const q = buildViewerQuery({
          limit: pageSize,
          offset: (page - 1) * pageSize,
        });
        const resp = await adminApi.getViewerSessions(q);
        setViewerRows(resp.items);
        setViewerTotal(resp.total);
      } catch (e) {
        message.error('加载观众会话失败');
        console.error(e);
      } finally {
        setLoadingViewer(false);
      }
    },
    [buildViewerQuery, vPage, vPageSize],
  );

  useEffect(() => {
    loadViewer(1, vPageSize);
    setVPage(1);
    // re-query when any filter changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vFilter, vUserId, vRange, vOnlyEnded]);

  const downloadCsv = async () => {
    setCsvLoading(true);
    try {
      await adminApi.downloadViewerSessionsCsv(buildViewerQuery());
      message.success('CSV 已导出');
    } catch (e) {
      message.error((e as Error).message || 'CSV 下载失败');
    } finally {
      setCsvLoading(false);
    }
  };

  return (
    <div>
      <Title level={3} style={{ margin: 0, marginBottom: 16 }}>
        播放统计
      </Title>

      <Tabs
        destroyInactiveTabPane={false}
        items={[
          // -----------------------------------------------------------
          // Primary: viewer sessions (WS-driven, permanent history)
          // -----------------------------------------------------------
          {
            key: 'viewer',
            label: '观众会话（WS）',
            children: (
              <>
                <Space wrap style={{ marginBottom: 12 }}>
                  <Input.Search
                    placeholder="按流名筛选"
                    allowClear
                    value={vFilter}
                    onChange={(e) => setVFilter(e.target.value)}
                    onSearch={setVFilter}
                    style={{ width: 200 }}
                  />
                  <InputNumber
                    placeholder="用户 ID"
                    min={1}
                    value={vUserId}
                    onChange={(v) => setVUserId(v ?? undefined)}
                    style={{ width: 120 }}
                  />
                  <RangePicker
                    showTime
                    // antd's RangePicker types are invariant on the date lib;
                    // since we only use ISO, we coerce through unknown.
                    value={vRange as unknown as never}
                    onChange={(v) =>
                      setVRange(v as unknown as [DateLike | null, DateLike | null] | null)
                    }
                  />
                  <Space size={4}>
                    <Switch checked={vOnlyEnded} onChange={setVOnlyEnded} size="small" />
                    <Text type="secondary">仅显示已结束</Text>
                  </Space>
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => loadViewer(vPage, vPageSize)}
                  >
                    刷新
                  </Button>
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    loading={csvLoading}
                    onClick={downloadCsv}
                  >
                    导出 CSV
                  </Button>
                </Space>

                <Table<ViewerSessionItem>
                  rowKey="id"
                  loading={loadingViewer}
                  dataSource={viewerRows}
                  size="small"
                  pagination={{
                    current: vPage,
                    pageSize: vPageSize,
                    total: viewerTotal,
                    showSizeChanger: true,
                    showTotal: (t) => `共 ${t} 条`,
                    onChange: (p, ps) => {
                      setVPage(p);
                      setVPageSize(ps);
                      loadViewer(p, ps);
                    },
                  }}
                  columns={[
                    { title: '#', dataIndex: 'id', width: 70 },
                    { title: '流名', dataIndex: 'stream_name' },
                    {
                      title: '用户',
                      dataIndex: 'user_id',
                      render: (v) => (v ? `#${v}` : <Tag>游客</Tag>),
                    },
                    { title: 'IP', dataIndex: 'client_ip' },
                    {
                      title: 'UA',
                      dataIndex: 'user_agent',
                      ellipsis: true,
                      render: (v: string) => (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {v || '—'}
                        </Text>
                      ),
                    },
                    { title: '开始', dataIndex: 'started_at', width: 180 },
                    {
                      title: '状态',
                      dataIndex: 'ended_at',
                      width: 90,
                      render: (v) =>
                        v ? <Tag>已结束</Tag> : <Tag color="green">观看中</Tag>,
                    },
                    {
                      title: '时长',
                      dataIndex: 'duration_seconds',
                      width: 100,
                      render: fmtDuration,
                    },
                  ]}
                />
              </>
            ),
          },
          // -----------------------------------------------------------
          // Legacy (SRS-hook-driven) — kept for backwards compatibility
          // -----------------------------------------------------------
          {
            key: 'play',
            label: 'SRS Play 会话（旧）',
            children: (
              <>
                <Space style={{ marginBottom: 12 }}>
                  <Input.Search
                    placeholder="按流名筛选"
                    allowClear
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    onSearch={loadLegacy}
                    style={{ width: 240 }}
                  />
                  <Button icon={<ReloadOutlined />} onClick={loadLegacy}>
                    刷新
                  </Button>
                </Space>
                <Table<StreamPlaySessionItem>
                  rowKey="id"
                  loading={loadingLegacy}
                  dataSource={plays}
                  size="small"
                  pagination={{ pageSize: 30 }}
                  columns={[
                    { title: '#', dataIndex: 'id', width: 70 },
                    { title: '流名', dataIndex: 'stream_name' },
                    {
                      title: '用户',
                      dataIndex: 'user_id',
                      render: (v) => v ?? <Tag>游客</Tag>,
                    },
                    { title: 'IP', dataIndex: 'client_ip' },
                    { title: '开始', dataIndex: 'started_at' },
                    {
                      title: '状态',
                      dataIndex: 'ended_at',
                      render: (v) =>
                        v ? <Tag>已结束</Tag> : <Tag color="green">观看中</Tag>,
                    },
                    { title: '时长', dataIndex: 'duration_seconds', render: fmtDuration },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'publish',
            label: '推流会话',
            children: (
              <>
                <Space style={{ marginBottom: 12 }}>
                  <Input.Search
                    placeholder="按流名筛选"
                    allowClear
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    onSearch={loadLegacy}
                    style={{ width: 240 }}
                  />
                  <Button icon={<ReloadOutlined />} onClick={loadLegacy}>
                    刷新
                  </Button>
                </Space>
                <Table<StreamPublishSessionItem>
                  rowKey="id"
                  loading={loadingLegacy}
                  dataSource={pubs}
                  size="small"
                  pagination={{ pageSize: 30 }}
                  columns={[
                    { title: '#', dataIndex: 'id', width: 70 },
                    { title: '流名', dataIndex: 'stream_name' },
                    { title: 'IP', dataIndex: 'client_ip' },
                    { title: '开始', dataIndex: 'started_at' },
                    {
                      title: '状态',
                      dataIndex: 'ended_at',
                      render: (v) =>
                        v ? <Tag>已下播</Tag> : <Tag color="green">直播中</Tag>,
                    },
                    { title: '时长', dataIndex: 'duration_seconds', render: fmtDuration },
                  ]}
                />
              </>
            ),
          },
        ]}
      />
    </div>
  );
};

export default Sessions;
