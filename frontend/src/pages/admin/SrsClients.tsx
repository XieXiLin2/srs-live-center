import { DisconnectOutlined, ReloadOutlined } from '@ant-design/icons';
import { App, Button, Popconfirm, Table, Tag, Typography } from 'antd';
import React, { useEffect, useState } from 'react';
import { adminApi } from '../../api';

const { Title } = Typography;

interface SrsClientRow {
  id: string;
  type?: string;
  vhost?: string;
  app?: string;
  stream?: string;
  ip?: string;
  alive?: number;
  // SRS may return either a boolean or an object like {active: bool} depending
  // on the version. We accept both shapes.
  publish?: boolean | { active?: boolean };
}
type SrsClientListResponse = { clients?: SrsClientRow[] };

const SrsClients: React.FC = () => {
  const { message } = App.useApp();
  const [rows, setRows] = useState<SrsClientRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = (await adminApi.getSrsClients()) as SrsClientListResponse | SrsClientRow[];
      const list = Array.isArray(data) ? data : data?.clients ?? [];
      setRows(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const kick = async (id: string) => {
    await adminApi.kickSrsClient(id);
    message.success('已踢出');
    load();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>SRS 客户端</Title>
        <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      </div>

      <Table<SrsClientRow>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        size="small"
        pagination={{ pageSize: 50 }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 120 },
          { title: '类型', dataIndex: 'type', render: (v?: string) => <Tag>{v ?? '—'}</Tag> },
          { title: '流', render: (_, r) => `${r.vhost || ''}/${r.app || ''}/${r.stream || ''}` },
          { title: 'IP', dataIndex: 'ip' },
          {
            title: '角色',
            dataIndex: 'publish',
            render: (p: SrsClientRow['publish'], r) => {
              // Truth table for "this client is a publisher":
              //   publish === true                  → publisher
              //   publish === { active: true }       → publisher
              //   type contains "publish"            → publisher (older SRS)
              const isPublisher =
                p === true ||
                (typeof p === 'object' && p !== null && p.active === true) ||
                (typeof r.type === 'string' && r.type.toLowerCase().includes('publish'));
              return isPublisher ? (
                <Tag color="green">推流</Tag>
              ) : (
                <Tag color="blue">播放</Tag>
              );
            },
          },
          {
            title: '时长',
            dataIndex: 'alive',
            render: (v?: number) => (v ? `${Math.floor(v)}s` : '—'),
          },
          {
            title: '操作',
            render: (_, r) => (
              <Popconfirm title="断开该客户端?" onConfirm={() => kick(r.id)}>
                <Button size="small" danger icon={<DisconnectOutlined />}>
                  踢出
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </div>
  );
};

export default SrsClients;
