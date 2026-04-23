// ---- User ----
export interface User {
  id: number;
  username: string;
  display_name: string;
  email: string;
  avatar_url: string;
  is_admin: boolean;
  is_banned?: boolean;
  created_at: string;
  last_login?: string;
}

// ---- Auth ----
export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface AuthURLResponse {
  authorize_url: string;
}

// ---- Chat ----
export interface ChatMessage {
  id: number;
  user_id: number;
  username: string;
  display_name: string;
  content: string;
  stream_name: string;
  created_at: string;
}

export interface WsMessage {
  type: 'message' | 'system' | 'error';
  id?: number;
  user_id?: number;
  username?: string;
  display_name?: string;
  avatar_url?: string;
  email?: string;
  content: string;
  created_at?: string;
  is_admin?: boolean;
  online_count?: number;
}

export interface ChatRoomConfig {
  stream_name: string;
  chat_enabled: boolean;
  require_login_to_send: boolean;
}

// ---- Stream ----
export interface StreamInfo {
  name: string;
  display_name: string;
  app: string;
  video_codec: string | null;
  audio_codec: string | null;
  clients: number;
  is_private: boolean;
  chat_enabled: boolean;
  /** Effective WebRTC playback permission (global AND per-room). */
  webrtc_play_enabled: boolean;
  is_live: boolean;
  formats: string[];
  offline_placeholder_url: string;
  show_on_homepage: boolean;
}

export interface StreamPlayResponse {
  url: string;
  stream_name: string;
  format: string;
}

export interface StreamConfig {
  id: number;
  stream_name: string;
  display_name: string;
  is_private: boolean;
  publish_secret: string;
  watch_token: string;
  chat_enabled: boolean;
  webrtc_play_enabled: boolean;
  offline_placeholder_url: string;
  show_on_homepage: boolean;
  is_live: boolean;
  viewer_count: number;
  total_play_count: number;
  last_publish_at: string | null;
  last_unpublish_at: string | null;
  created_at: string;
  updated_at: string;
  /** Computed RTMP publish URL (derived from settings.publish_base_url). */
  publish_rtmp_url: string | null;
  /** Computed SRT publish URL. */
  publish_srt_url: string | null;
  /** Computed WHIP publish URL. */
  publish_whip_url: string | null;
}

// ---- Edge nodes ----
export interface EdgeNode {
  id: number;
  slug: string;
  name: string;
  base_url: string;
  description: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface EdgeNodePublic {
  slug: string;
  name: string;
  base_url: string;
  description: string;
}

export interface PlaybackSources {
  origin: EdgeNodePublic;
  edges: EdgeNodePublic[];
}


// ---- Admin ----
export interface UserListResponse {
  users: User[];
  total: number;
}

export interface ChatHistoryResponse {
  messages: ChatMessage[];
  total: number;
}

export interface StreamStats {
  stream_name: string;
  display_name: string;
  is_live: boolean;
  /** Current concurrent viewers (open play sessions). Backend-owned. */
  current_viewers: number;
  /** Lifetime play count since this room was created. */
  total_plays: number;
  /** Lifetime total watch-seconds across all viewers. */
  total_watch_seconds: number;
  /** Distinct logged-in viewers who have ever played this stream. */
  unique_logged_in_viewers: number;
  /** Peak concurrent viewers observed during the current live session. */
  peak_session_viewers: number;
  /** Seconds the current broadcast has been live; 0 when offline. */
  current_live_duration_seconds: number;
  /** Lifetime broadcast time across all past + current publish sessions. */
  total_live_seconds: number;
  last_publish_at: string | null;
  last_unpublish_at: string | null;
  /** When the currently-active publisher started (null if offline). */
  current_session_started_at: string | null;
}

export interface StreamPublishSessionItem {
  id: number;
  srs_client_id: string;
  stream_name: string;
  client_ip: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
}

export interface ViewerSessionItem {
  id: number;
  session_key: string;
  stream_name: string;
  user_id: number | null;
  client_ip: string;
  user_agent: string;
  started_at: string;
  last_heartbeat_at: string;
  ended_at: string | null;
  duration_seconds: number;
}

export interface ViewerSessionListResponse {
  items: ViewerSessionItem[];
  total: number;
}

export interface ViewerSessionsQuery {
  stream_name?: string;
  user_id?: number;
  started_after?: string;
  started_before?: string;
  only_ended?: boolean;
  limit?: number;
  offset?: number;
}
