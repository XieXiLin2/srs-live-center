import { SaveOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Spin,
  Typography,
} from 'antd';

import React, { useEffect, useState } from 'react';
import { adminApi, brandingApi, type BrandingPayload } from '../../api';
import { useBranding } from '../../store/branding';

const { Title, Paragraph } = Typography;

/**
 * Admin settings page.
 *
 * Two sections:
 *
 *  1. **站点品牌** — editable from the UI and persisted in the ``app_settings``
 *     KV table. Saved via ``PUT /api/admin/branding``; on success we call
 *     ``BrandingProvider.refresh()`` so the header/footer update without a
 *     page reload.
 *
 *  2. **环境变量** — read-only snapshot of the ``.env``-driven values that
 *     require a backend restart to change. Kept at the bottom so the editable
 *     branding card is the first thing an admin sees.
 */
const Settings: React.FC = () => {
  const { message } = App.useApp();
  const { refresh: refreshBranding } = useBranding();

  // ---- Env settings (read-only) ----
  const [envLoading, setEnvLoading] = useState(true);
  const [envData, setEnvData] = useState<Record<string, string>>({});

  useEffect(() => {
    adminApi
      .getSettings()
      .then(setEnvData)
      .finally(() => setEnvLoading(false));
  }, []);

  // ---- Branding (editable) ----
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<BrandingPayload>();

  useEffect(() => {
    brandingApi
      .get()
      .then((data) => form.setFieldsValue(data))
      .finally(() => setBrandingLoading(false));
  }, [form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await brandingApi.update(values);
      await refreshBranding();
      message.success('品牌信息已保存');
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } }; errorFields?: unknown };
      if (e.errorFields) return; // form validation — Form already shows the errors inline.
      message.error(e.response?.data?.detail || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Title level={3}>系统设置</Title>

      {/* Branding card */}
      <Card
        title="站点品牌"
        style={{ marginBottom: 24 }}
        extra={
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
          >
            保存
          </Button>
        }
      >
        <Paragraph type="secondary" style={{ marginTop: 0 }}>
          这些值用于页面左上角的 Logo / 站点名、页面标题后缀以及底部的版权文案。
          修改后会立刻生效，无需重启服务。页面标题会自动拼接为
           <code>当前页面 :: 站点名</code> 的格式。页脚 Copyright 支持 HTML 标签（如 &lt;a&gt;、&lt;br&gt;）和换行。
        </Paragraph>
        {brandingLoading ? (
          <Spin />
        ) : (
          <Form form={form} layout="vertical" disabled={saving}>
            <Form.Item
              label="站点名称"
              name="site_name"
              rules={[{ required: true, message: '站点名称不能为空' }]}
              extra="同时作为左上角标题以及页面标题的后缀。"
            >
              <Input placeholder="例如 My Live Center" maxLength={128} showCount />
            </Form.Item>
            <Form.Item
              label="Logo 图片 URL"
              name="logo_url"
              extra="展示在左上角。留空则使用默认的播放图标。建议使用方形小图（如 64x64）。"
            >
              <Input placeholder="https://example.com/logo.png" maxLength={1024} />
            </Form.Item>
            <Form.Item
              label="页脚 Copyright"
              name="copyright"
              extra={
                <>
                  展示在页面最底部。支持 <code>{'{year}'}</code> 占位符，
                  会在渲染时自动替换为当前年份。
                </>
              }
            >
              <Input.TextArea
                rows={2}
                placeholder="© {year} Your Company. All rights reserved."
                maxLength={512}
                showCount
              />
            </Form.Item>
            <Form.Item
              label="全局离线占位内容 URL"
              name="offline_placeholder_url"
              extra="直播间未开播时显示的默认图片、视频或音频 URL。支持 mp4/webm/ogg/mov 视频格式，其他格式作为图片显示。各直播间可单独配置覆盖此全局设置。"
            >
              <Input
                placeholder="https://example.com/offline.mp4"
                maxLength={1024}
              />
            </Form.Item>
            <Form.Item
              label="工信部备案号"
              name="icp_filing"
              extra="例如：京ICP备12345678号-1。留空则不显示。"
            >
              <Input placeholder="京ICP备12345678号-1" maxLength={256} />
            </Form.Item>
            <Form.Item
              label="公安备案号"
              name="mps_filing"
              extra="例如：京公网安备 11010502012345号。留空则不显示。会自动显示公安备案图标。"
            >
              <Input placeholder="京公网安备 11010502012345号" maxLength={256} />
            </Form.Item>
            <Form.Item
              label="MoeICP 备案号"
              name="moeicp_filing"
              extra="例如：萌ICP备20231234号。留空则不显示。会自动显示 MoeICP 图标。"
            >
              <Input placeholder="萌ICP备20231234号" maxLength={256} />
            </Form.Item>
          </Form>
        )}
      </Card>

      {/* Env (read-only) card */}
      <Card title="环境变量（只读）">
        <Paragraph type="secondary" style={{ marginTop: 0 }}>
          以下配置由后端 <code>.env</code> 管理，修改需重启服务。
        </Paragraph>
        {envLoading ? (
          <Spin />
        ) : (
          <Descriptions column={1} bordered size="small">
            {Object.entries(envData).map(([k, v]) => (
              <Descriptions.Item key={k} label={k}>
                <code>{String(v)}</code>
              </Descriptions.Item>
            ))}
          </Descriptions>
        )}
      </Card>
    </div>
  );
};

export default Settings;
