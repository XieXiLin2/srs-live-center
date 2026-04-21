import {
  DashboardOutlined,
  LoginOutlined,
  LogoutOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Dropdown, Layout, Menu, Space, theme, Typography } from 'antd';
import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { resolveAvatar } from '../utils/avatar';

const { Header, Content, Footer } = Layout;
const { Text } = Typography;

const AppLayout: React.FC = () => {
  const { user, login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { token: themeToken } = theme.useToken();

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
          <PlayCircleOutlined style={{ fontSize: 24, color: themeToken.colorPrimary }} />
          <Text strong style={{ fontSize: 18 }}>
            Ayumu Live Center
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
        Ayumu Network & XieXiLin &copy; 2021-{new Date().getFullYear()}. All rights reserved.
      </Footer>
    </Layout>
  );
};

export default AppLayout;
