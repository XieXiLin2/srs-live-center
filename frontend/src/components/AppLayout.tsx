import {
  DashboardOutlined,
  LoginOutlined,
  LogoutOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Dropdown, Layout, Menu, Space, theme, Typography } from 'antd';
import React, { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useBranding } from '../store/branding';
import { resolveAvatar } from '../utils/avatar';

const { Header, Content, Footer } = Layout;
const { Text } = Typography;

/**
 * Map a pathname to the page-title segment shown to the left of " :: ".
 *
 * Pages that render their own dynamic title (e.g. the stream detail page,
 * which wants to show the room's ``display_name``) call ``usePageTitle``
 * directly and override whatever this default produced. We still set a
 * sensible default here so there's no 1-frame flash of the previous title.
 */
function titleForPath(pathname: string): string {
  if (pathname === '/' || pathname === '') return '主页';
  if (pathname.startsWith('/admin')) {
    const tail = pathname.replace(/^\/admin\/?/, '');
    const seg = tail.split('/')[0] ?? '';
    switch (seg) {
      case '':
        return '总览';
      case 'streams':
        return '直播间管理';
      case 'edge-nodes':
        return 'Edge 节点';
      case 'sessions':
        return '播放会话';
      case 'srs-clients':
        return 'SRS 客户端';
      case 'users':
        return '用户管理';
      case 'settings':
        return '系统设置';
      default:
        return '管理后台';
    }
  }
  if (pathname.startsWith('/auth/callback')) return '登录回调';
  return '';
}

const AppLayout: React.FC = () => {
  const { user, login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { token: themeToken } = theme.useToken();
  const { site_name, logo_url, copyright, icp_filing, mps_filing, moeicp_filing } = useBranding();

  // Default page title: updates on every route change. Stream detail pages
  // and similar override this by calling ``usePageTitle`` themselves.
  useEffect(() => {
    const page = titleForPath(location.pathname);
    document.title = page ? `${page} :: ${site_name}` : site_name;
  }, [location.pathname, site_name]);

  const menuItems = [
    { key: '/', icon: <PlayCircleOutlined />, label: '直播' },
    ...(user?.is_admin
      ? [{ key: '/admin', icon: <DashboardOutlined />, label: '管理' }]
      : []),
  ];

  const userMenuItems = user
    ? [
        { key: 'profile', icon: <UserOutlined />, label: user.display_name || user.username },
        ...(user.is_admin
          ? [{ key: 'admin', icon: <SettingOutlined />, label: '管理后台' }]
          : []),
        { type: 'divider' as const },
        { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
      ]
    : [];

  const handleUserMenu = ({ key }: { key: string }) => {
    if (key === 'logout') logout();
    else if (key === 'admin') navigate('/admin');
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          background: themeToken.colorBgContainer,
          borderBottom: `1px solid ${themeToken.colorBorderSecondary}`,
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <Space>
          {logo_url ? (
            <img
              src={logo_url}
              alt={site_name}
              style={{
                height: 28,
                width: 28,
                objectFit: 'contain',
                borderRadius: 4,
                cursor: 'pointer',
              }}
              onClick={() => navigate('/')}
              onError={(e) => {
                // Fall back to hiding the broken image rather than showing
                // the ugly default "missing image" icon in the header.
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <PlayCircleOutlined
              style={{ fontSize: 24, color: themeToken.colorPrimary, cursor: 'pointer' }}
              onClick={() => navigate('/')}
            />
          )}
          <Text
            strong
            style={{ fontSize: 18, cursor: 'pointer' }}
            onClick={() => navigate('/')}
          >
            {site_name}
          </Text>
          <Menu
            mode="horizontal"
            selectedKeys={[location.pathname === '/' ? '/' : `/${location.pathname.split('/')[1]}`]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ border: 'none', marginLeft: 16 }}
          />
        </Space>

        <Space>
          {user ? (
            <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenu }} placement="bottomRight">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar
                  src={resolveAvatar(user.avatar_url, user.email, { size: 64 })}
                  icon={<UserOutlined />}
                  size="small"
                />
                <Text>{user.display_name || user.username}</Text>
              </Space>
            </Dropdown>
          ) : (
            <Button type="primary" icon={<LoginOutlined />} onClick={login}>
              登录
            </Button>
          )}
        </Space>
      </Header>

      <Content style={{ padding: '24px', maxWidth: 1400, width: '100%', margin: '0 auto' }}>
        <Outlet />
      </Content>

      <Footer style={{ textAlign: 'center', color: themeToken.colorTextSecondary }}>
        <div dangerouslySetInnerHTML={{ __html: copyright }} style={{ marginBottom: 8 }} />
        {(icp_filing || mps_filing || moeicp_filing) && (
          <div style={{ fontSize: 12, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {icp_filing && <span>{icp_filing}</span>}
            {icp_filing && (mps_filing || moeicp_filing) && <span>|</span>}
            {mps_filing && (
              <a href="http://www.beian.gov.cn/" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'inherit', textDecoration: 'none' }}>
                <img src="/beian-mps-icon.png" alt="" style={{ height: 14 }} />
                <span>{mps_filing}</span>
              </a>
            )}
            {mps_filing && moeicp_filing && <span>|</span>}
            {moeicp_filing && (
              <a href="https://icp.gov.moe/" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'inherit', textDecoration: 'none' }}>
                <img src="/moeicp-icon120.png" alt="" style={{ height: 14 }} />
                <span>{moeicp_filing}</span>
              </a>
            )}
          </div>
        )}
      </Footer>
    </Layout>
  );
};

export default AppLayout;
