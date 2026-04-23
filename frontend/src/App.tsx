import { App as AntdApp, ConfigProvider, Spin, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import Home from './pages/Home';

import { AuthProvider, useAuth } from './store/auth';
import { BrandingProvider } from './store/branding';

// Lazy load route components
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const LiveRoom = lazy(() => import('./pages/LiveRoom'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const Sessions = lazy(() => import('./pages/admin/Sessions'));
const Settings = lazy(() => import('./pages/admin/Settings'));
const SrsClients = lazy(() => import('./pages/admin/SrsClients'));
const EdgeManage = lazy(() => import('./pages/admin/EdgeManage'));
const StreamDetail = lazy(() => import('./pages/admin/StreamDetail'));
const StreamsManage = lazy(() => import('./pages/admin/StreamsManage'));
const UsersManage = lazy(() => import('./pages/admin/UsersManage'));


const AppContent: React.FC = () => {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  return (
    <Suspense fallback={
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="加载中..." />
      </div>
    }>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route element={<AppLayout />}>
          <Route index element={<Home />} />
          <Route path="/live/:roomname" element={<LiveRoom />} />
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="streams" element={<StreamsManage />} />
            <Route path="streams/:name" element={<StreamDetail />} />
            <Route path="edge-nodes" element={<EdgeManage />} />
            <Route path="sessions" element={<Sessions />} />

            <Route path="srs-clients" element={<SrsClients />} />
            <Route path="users" element={<UsersManage />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
};

const App: React.FC = () => {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
        },
      }}
    >
      <AntdApp>
        <BrowserRouter>
          <BrandingProvider>
            <AuthProvider>
              <AppContent />
            </AuthProvider>
          </BrandingProvider>
        </BrowserRouter>
      </AntdApp>

    </ConfigProvider>
  );
};

export default App;
