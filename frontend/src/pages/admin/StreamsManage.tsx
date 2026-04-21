import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import React, { useEffect, useState } from 'react';
import { streamApi } from '../../api';
import type { StreamConfig } from '../../types';

const { Title, Text } = Typography;

const copy = async (v: string) => {
  try { await navigator.clipboard.writeText(v); } catch { /* ignore */ }
};

const StreamsManage: React.FC = () => {
  const { message } = App.useApp();
  const [rows, setRows] = useState<StreamConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; row?: StreamConfig | null }>({ open: false });
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const data = await streamApi.listConfigs();
      setRows(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openEdit = (row?: StreamConfig) => {
    form.resetFields();
    if (row) {
      form.setFieldsValue(row);
    } else {
      form.setFieldsValue({ is_private: false, chat_enabled: true, webrtc_play_enabled: true });
    }
    setModal({ open: true, row });
  };

  const submit = async () => {
    const v = await form.validateFields();
    const stream_name = v.stream_name?.trim();
    if (!stream_name) return;
    await streamApi.updateConfig(stream_name, {
      display_name: v.display_name ?? '',
      is_private: !!v.is_private,
      chat_enabled: !!v.chat_enabled,
      webrtc_play_enabled: !!v.webrtc_play_enabled,
      publish_secret: v.publish_secret || undefined,
      watch_token: v.watch_token || undefined,
    });
    message.success('保存成功');
    setModal({ open: false });
    load();
  };

  const del = async (name: string) => {
    await streamApi.deleteConfig(name);
    message.success('已删除');
    load();
  };

  const rotateSecret = async (name: string) => {
    await streamApi.rotatePublishSecret(name);
    message.success('推流密钥已轮换');
    load();
  };

  const rotateToken = async (name: string) => {
    await streamApi.rotateWatchToken(name);
    message.success('观看 Token 已轮换');
    load();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>直播间管理</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit()}>新建直播间</Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: '流名', dataIndex: 'stream_name' },
          { title: '显示名', dataIndex: 'display_name' },
          {
            title: '可见性',
            dataIndex: 'is_private',
            render: (v: boolean) => v ? <Tag color="purple">私有</Tag> : <Tag color="blue">公开</Tag>,
          },
          {
            title: '状态',
            dataIndex: 'is_live',
            render: (v: boolean) => v ? <Tag color="green">直播中</Tag> : <Tag>离线</Tag>,
          },
          { title: '当前观众', dataIndex: 'viewer_count' },
          { title: '累计观看', dataIndex: 'total_play_count' },
          {
            title: '聊天',
            dataIndex: 'chat_enabled',
            render: (v: boolean) => v ? <Tag color="green">开</Tag> : <Tag color="red">关</Tag>,
          },
          {
            title: 'WebRTC 播放',
            dataIndex: 'webrtc_play_enabled',
            render: (v: boolean) => v ? <Tag color="green">允许</Tag> : <Tag color="red">禁止</Tag>,
          },
          {
            title: '密钥',
            render: (_, r) => (
              // Public rooms don't consume `watch_token` for playback, so we
              // omit it to reduce clutter. The value is still stored server-
              // side so it can be reused immediately if the room is later
              // flipped to private.
              <Space direction="vertical" size={2}>
                <Text copyable={{ text: r.publish_secret }} style={{ fontSize: 12 }}>
                  推流: <code>{r.publish_secret?.slice(0, 8)}…</code>
                </Text>
                {r.is_private && (
                  <Text copyable={{ text: r.watch_token }} style={{ fontSize: 12 }}>
                    Token: <code>{r.watch_token?.slice(0, 8)}…</code>
                  </Text>
                )}
              </Space>
            ),
          },
          {
            title: '操作',
            render: (_, r) => (
              <Space>
                <Tooltip title="复制 RTMP 推流地址">
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      const host = window.location.hostname;
                      copy(`rtmp://${host}/live/${r.stream_name}?secret=${r.publish_secret}`);
                      message.success('已复制 RTMP 推流地址');
                    }}
                  />
                </Tooltip>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                <Popconfirm title="轮换推流密钥?" onConfirm={() => rotateSecret(r.stream_name)}>
                  <Button size="small">换推流密钥</Button>
                </Popconfirm>
                {/* 观看 Token 仅对私有房间有意义，公开房间不展示以免误导。 */}
                {r.is_private && (
                  <Popconfirm title="轮换观看 Token?" onConfirm={() => rotateToken(r.stream_name)}>
                    <Button size="small">换 Token</Button>
                  </Popconfirm>
                )}
                <Popconfirm title="删除此直播间?" onConfirm={() => del(r.stream_name)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={modal.open}
        title={modal.row ? '编辑直播间' : '新建直播间'}
        onCancel={() => setModal({ open: false })}
        onOk={submit}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="stream_name"
            label="流名 (URL 最后一段)"
            rules={[{ required: true, pattern: /^[a-zA-Z0-9_-]+$/, message: '仅支持字母数字、下划线与连字符' }]}
          >
            <Input placeholder="例如 demo" disabled={!!modal.row} />
          </Form.Item>
          <Form.Item name="display_name" label="显示名称">
            <Input placeholder="例如 我的直播间" />
          </Form.Item>
          <Form.Item name="is_private" label="私有直播" valuePropName="checked">
            <Switch checkedChildren="是" unCheckedChildren="否" />
          </Form.Item>
          <Form.Item name="chat_enabled" label="开启聊天" valuePropName="checked">
            <Switch checkedChildren="开" unCheckedChildren="关" />
          </Form.Item>
          <Form.Item
            name="webrtc_play_enabled"
            label="允许 WebRTC 播放"
            valuePropName="checked"
            extra="关闭后本房间禁止 WHEP 拉流（低延迟播放），但 WebRTC 推流（WHIP）不受影响。"
          >
            <Switch checkedChildren="允许" unCheckedChildren="禁止" />
          </Form.Item>
          <Form.Item name="publish_secret" label="推流密钥（留空自动生成）">
            <Input.Password />
          </Form.Item>
          {/*
            Watch token is only relevant for private rooms; hide the input
            unless the "private" switch is on so admins aren't confused.
          */}
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.is_private !== cur.is_private}
          >
            {({ getFieldValue }) =>
              getFieldValue('is_private') ? (
                <Form.Item name="watch_token" label="观看 Token（私有流使用；留空自动生成）">
                  <Input.Password />
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default StreamsManage;
