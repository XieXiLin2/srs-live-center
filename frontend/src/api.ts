import axios from 'axios';
import type {
  AuthURLResponse,
  ChatHistoryResponse,
  ChatRoomConfig,
  StreamConfig,
  StreamInfo,
  StreamPlayResponse,
  StreamPlaySessionItem,
  StreamPublishSessionItem,
  StreamStats,
  TokenResponse,
  User,
  UserListResponse,
  ViewerSessionListResponse,
  ViewerSessionsQuery,
} from './types';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

// Attach token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
    return Promise.reject(err);
  }
);

// ---- Auth ----
export const authApi = {
  getLoginUrl: () => api.get<AuthURLResponse>('/auth/login').then((r) => r.data),
  callback: (code: string, state?: string) =>
    api.post<TokenResponse>('/auth/callback', { code, state }).then((r) => r.data),
  getMe: () => api.get<User>('/auth/me').then((r) => r.data),
  logout: () => api.get<{ logout_url: string | null }>('/auth/logout').then((r) => r.data),
};

// ---- Streams (public + admin) ----
export const streamApi = {
  list: () => api.get<{ streams: StreamInfo[] }>('/streams/').then((r) => r.data),
  play: (stream_name: string, format: string, token?: string) =>
    api
      .post<StreamPlayResponse>('/streams/play', { stream_name, format, token })
      .then((r) => r.data),
  getChatConfig: (stream_name: string) =>
    api.get<ChatRoomConfig>(`/streams/${stream_name}/chat-config`).then((r) => r.data),
  getStats: (stream_name: string) =>
    api.get<StreamStats>(`/streams/${stream_name}/stats`).then((r) => r.data),

  // --- Admin ---
  listConfigs: () => api.get<StreamConfig[]>('/streams/config').then((r) => r.data),
  updateConfig: (
    stream_name: string,
    data: Partial<Omit<StreamConfig, 'id' | 'created_at' | 'updated_at'>>
  ) => api.put<StreamConfig>(`/streams/config/${stream_name}`, data).then((r) => r.data),
  rotatePublishSecret: (stream_name: string) =>
    api
      .post<StreamConfig>(`/streams/config/${stream_name}/rotate-publish-secret`)
      .then((r) => r.data),
  rotateWatchToken: (stream_name: string) =>
    api
      .post<StreamConfig>(`/streams/config/${stream_name}/rotate-watch-token`)
      .then((r) => r.data),
  deleteConfig: (stream_name: string) => api.delete(`/streams/config/${stream_name}`),
};

// ---- Chat ----
export const chatApi = {
  getHistory: (stream_name: string, limit = 50, offset = 0) =>
    api
      .get<ChatHistoryResponse>(`/chat/history/${stream_name}`, { params: { limit, offset } })
      .then((r) => r.data),
  getOnlineCount: (stream_name: string) =>
    api.get<{ online_count: number }>(`/chat/online/${stream_name}`).then((r) => r.data),
};

// ---- Admin (SRS status + stats + users) ----
export const adminApi = {
  // Users
  listUsers: (params?: { limit?: number; offset?: number; search?: string }) =>
    api.get<UserListResponse>('/admin/users', { params }).then((r) => r.data),
  banUser: (userId: number, is_banned: boolean) =>
    api.put(`/admin/users/${userId}/ban`, { is_banned }),
  deleteMessage: (messageId: number) => api.delete(`/admin/chat/messages/${messageId}`),

  // SRS system
  getSrsSummary: () => api.get('/admin/srs/summary').then((r) => r.data),
  getSrsVersions: () => api.get('/admin/srs/versions').then((r) => r.data),
  getSrsStreams: () => api.get('/admin/srs/streams').then((r) => r.data),
  getSrsClients: () => api.get('/admin/srs/clients').then((r) => r.data),
  kickSrsClient: (clientId: string) => api.delete(`/admin/srs/clients/${clientId}`),

  // Live statistics
  getPlaySessions: (stream_name = '', limit = 50, offset = 0) =>
    api
      .get<StreamPlaySessionItem[]>('/admin/stats/play-sessions', {
        params: { stream_name, limit, offset },
      })
      .then((r) => r.data),
  getPublishSessions: (stream_name = '', limit = 50, offset = 0) =>
    api
      .get<StreamPublishSessionItem[]>('/admin/stats/publish-sessions', {
        params: { stream_name, limit, offset },
      })
      .then((r) => r.data),

  // Viewer sessions (WS-driven playback history, the primary analytics source)
  getViewerSessions: (params: ViewerSessionsQuery = {}) =>
    api
      .get<ViewerSessionListResponse>('/admin/stats/viewer-sessions', {
        params: { limit: 50, offset: 0, ...params },
      })
      .then((r) => r.data),
  getViewerSessionsSummary: (
    params: Pick<ViewerSessionsQuery, 'stream_name' | 'started_after' | 'started_before'> = {},
  ) =>
    api
      .get<{
        stream_name: string | null;
        started_after: string | null;
        started_before: string | null;
        total_sessions: number;
        total_watch_seconds: number;
        unique_logged_in_viewers: number;
        per_stream: Array<{ stream_name: string; sessions: number; watch_seconds: number }>;
      }>('/admin/stats/viewer-sessions/summary', { params })
      .then((r) => r.data),
  /**
   * Download viewer-sessions CSV via authenticated fetch + Blob.
   * (A plain `<a href download>` won't carry the Bearer header.)
   */
  downloadViewerSessionsCsv: async (params: ViewerSessionsQuery = {}): Promise<void> => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      qs.append(k, String(v));
    });
    const url = `/api/admin/stats/viewer-sessions.csv${qs.toString() ? `?${qs.toString()}` : ''}`;
    const token = localStorage.getItem('token');
    const resp = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!resp.ok) {
      throw new Error(`CSV 下载失败: HTTP ${resp.status}`);
    }
    const blob = await resp.blob();
    // Try to honor server-provided filename; fall back to a sane default.
    const cd = resp.headers.get('Content-Disposition') || '';
    const m = /filename="?([^"]+)"?/i.exec(cd);
    const filename =
      (m && m[1]) ||
      `viewer-sessions_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  },

  // App settings
  getSettings: () => api.get<Record<string, string>>('/admin/settings').then((r) => r.data),
};

export default api;
