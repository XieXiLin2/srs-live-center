import { CloudServerOutlined, PlayCircleOutlined, TeamOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { Card, Col, Descriptions, Row, Spin, Statistic, Typography } from 'antd';
import React, { useEffect, useState } from 'react';
import { adminApi } from '../../api';

const { Title } = Typography;

const Dashboard: React.FC = () => {
  const [systemInfo, setSystemInfo] = useState<Record<string, unknown> | null>(null);
  const [versions, setVersions] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      adminApi.getSystemInfo().catch(() => null),
      adminApi.getVersions().catch(() => null),
      adminApi.getStatus().catch(() => null),
    ]).then(([sys, ver, _status]) => {
      if (cancelled) return;
      setSystemInfo(sys);
      setVersions(ver);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  const data = (systemInfo as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
  const server = data?.self as Record<string, unknown> | undefined;

  return (
    <div>
      <Title level={4}>
        <CloudServerOutlined /> 系统概览
      </Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="SRS 连接数"
              value={server?.conn_srs as number ?? 0}
              prefix={<TeamOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="系统连接数"
              value={server?.conn_sys as number ?? 0}
              prefix={<PlayCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="CPU 使用率"
              value={server?.cpu_percent as number ?? 0}
              suffix="%"
              precision={1}
              prefix={<CloudServerOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="内存 (KB)"
              value={server?.mem_kbyte as number ?? 0}
              prefix={<VideoCameraOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {server && (
        <Card title="服务器信息" style={{ marginBottom: 16 }}>
          <Descriptions column={{ xs: 1, sm: 2 }} size="small">
            <Descriptions.Item label="版本">{String(server.version ?? '-')}</Descriptions.Item>
            <Descriptions.Item label="PID">{String(server.pid ?? '-')}</Descriptions.Item>
            <Descriptions.Item label="工作目录">{String(server.cwd ?? '-')}</Descriptions.Item>
            <Descriptions.Item label="接收字节">{String(server.recv_bytes ?? 0)}</Descriptions.Item>
            <Descriptions.Item label="发送字节">{String(server.send_bytes ?? 0)}</Descriptions.Item>
            <Descriptions.Item label="TCP 连接">{String(server.conn_sys_et ?? 0)}</Descriptions.Item>
            <Descriptions.Item label="UDP 连接">{String(server.conn_sys_udp ?? 0)}</Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {versions && (
        <Card title="版本信息">
          <pre style={{ margin: 0, fontSize: 12 }}>
            {JSON.stringify(versions, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
};

export default Dashboard;
