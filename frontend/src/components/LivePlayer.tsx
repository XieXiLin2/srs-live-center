import Artplayer from 'artplayer';
import artplayerPluginDanmuku from 'artplayer-plugin-danmuku';
import artplayerPluginDocumentPip from 'artplayer-plugin-document-pip';
import mpegts from 'mpegts.js';
import React, { useEffect, useMemo, useRef } from 'react';

interface LivePlayerProps {
  url: string;
  /** 'flv' (HTTP-FLV via mpegts.js) or 'webrtc' (WHEP). */
  format: string;
  /** Whether the stream is currently live. */
  isLive: boolean;
  /** URL of placeholder content (image or video) to show when offline. */
  placeholderUrl?: string;
  /** Whether chat/danmaku is enabled for this stream. */
  chatEnabled?: boolean;
  style?: React.CSSProperties;
}

/**
 * Establish a WebRTC WHEP session against SRS and attach the remote stream
 * to the given <video> element.
 *
 * SRS implements the WHEP draft with a small extension:
 *   POST {url}  Content-Type: application/sdp   Body: local offer SDP
 *   → 200 OK   Body: answer SDP (application/sdp)
 */
async function playWebRTC(
  video: HTMLVideoElement,
  whepUrl: string,
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
  });

  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });

  const remoteStream = new MediaStream();
  video.srcObject = remoteStream;
  pc.ontrack = (event) => {
    remoteStream.addTrack(event.track);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const resp = await fetch(whepUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: offer.sdp || '',
  });
  if (!resp.ok) {
    throw new Error(`WHEP ${resp.status}: ${await resp.text()}`);
  }
  const answerSdp = await resp.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  return pc;
}

const LivePlayer: React.FC<LivePlayerProps> = ({ url, format, isLive, placeholderUrl, chatEnabled = true, style }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<Artplayer | null>(null);
  const mpegtsRef = useRef<ReturnType<typeof mpegts.createPlayer> | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showPlaceholder, setShowPlaceholder] = React.useState(false);
  const wasLiveRef = useRef(isLive);

  const placeholderMediaType = useMemo(() => {
    if (!placeholderUrl) return null;
    const ext = placeholderUrl.split('.').pop()?.toLowerCase();
    if (['mp4', 'webm', 'ogg', 'mov'].includes(ext || '')) return 'video';
    if (['mp3', 'wav', 'ogg', 'aac', 'm4a'].includes(ext || '')) return 'audio';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext || '')) return 'image';
    // Assume it's a stream URL (HLS/FLV/etc)
    return 'stream';
  }, [placeholderUrl]);

  // Handle 5-minute delay before showing placeholder
  useEffect(() => {
    // Clear any existing timer
    if (offlineTimerRef.current) {
      clearTimeout(offlineTimerRef.current);
      offlineTimerRef.current = null;
    }

    if (isLive) {
      // Stream is live - hide placeholder immediately (use setTimeout to avoid sync setState in effect)
      setTimeout(() => setShowPlaceholder(false), 0);
      wasLiveRef.current = true;
    } else if (wasLiveRef.current && placeholderUrl) {
      // Stream just went offline and we have a placeholder - start 5-minute timer
      offlineTimerRef.current = setTimeout(() => {
        setShowPlaceholder(true);
      }, 5 * 60 * 1000); // 5 minutes
      wasLiveRef.current = false;
    } else if (!wasLiveRef.current && placeholderUrl) {
      // Stream was already offline (initial load) - show placeholder immediately
      setTimeout(() => setShowPlaceholder(true), 0);
    }

    return () => {
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
    };
  }, [isLive, placeholderUrl]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Show placeholder if offline and placeholder URL is provided
    if (showPlaceholder && placeholderUrl) {
      // Tear down any existing players
      mpegtsRef.current?.destroy();
      mpegtsRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
      if (artRef.current) {
        artRef.current.destroy();
        artRef.current = null;
      }

      // Handle image placeholders separately (ArtPlayer can't play images)
      if (placeholderMediaType === 'image') {
        const container = containerRef.current;
        const img = document.createElement('img');
        img.src = placeholderUrl;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        img.alt = '直播间离线';
        container.innerHTML = '';
        container.appendChild(img);
        return () => {
          if (container) {
            container.innerHTML = '';
          }
        };
      }

      // Create ArtPlayer with placeholder content (video/audio/stream)
      const options: ConstructorParameters<typeof Artplayer>[0] = {
        container: containerRef.current,
        url: placeholderUrl,
        isLive: placeholderMediaType === 'stream',
        autoplay: true,
        muted: placeholderMediaType === 'video',
        loop: placeholderMediaType === 'video' || placeholderMediaType === 'audio',
        autoSize: false,
        autoMini: false,
        playbackRate: false,
        aspectRatio: true,
        setting: false,
        pip: false,
        fullscreen: true,
        fullscreenWeb: true,
        mutex: true,
        backdrop: true,
        theme: '#1677ff',
        lang: 'zh-cn',
        moreVideoAttr: {
          crossOrigin: 'anonymous',
          playsInline: true,
        },
      };

      const art = new Artplayer(options);
      artRef.current = art;

      return () => {
        if (artRef.current) {
          artRef.current.destroy();
          artRef.current = null;
        }
      };
    }

    // Show live stream if online and URL is provided
    if (!showPlaceholder && url) {
      // Tear down previous players.
      mpegtsRef.current?.destroy();
      mpegtsRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
      if (artRef.current) {
        artRef.current.destroy();
        artRef.current = null;
      }

      const options: ConstructorParameters<typeof Artplayer>[0] = {
        container: containerRef.current,
        url,
        isLive: true,
        autoplay: true,
        muted: false,
        autoSize: false,
        autoMini: false,
        loop: false,
        flip: true,
        playbackRate: false,
        aspectRatio: true,
        setting: true,
        pip: true,
        fullscreen: true,
        fullscreenWeb: true,
        mutex: true,
        backdrop: true,
        theme: '#1677ff',
        lang: 'zh-cn',
        moreVideoAttr: {
          crossOrigin: 'anonymous',
          playsInline: true,
        },
        plugins: [
          artplayerPluginDocumentPip({}),
          ...(chatEnabled ? [artplayerPluginDanmuku({
            danmuku: [],
            speed: 5,
            opacity: 1,
            fontSize: 25,
            color: '#FFFFFF',
            mode: 0,
            margin: [10, '25%'],
            antiOverlap: true,
            synchronousPlayback: false,
            lockTime: 5,
            maxLength: 100,
          })] : []),
        ],
      };

      if (format === 'flv' && mpegts.isSupported()) {
        options.customType = {
          flv: (video: HTMLVideoElement, streamUrl: string) => {
            const player = mpegts.createPlayer({
              type: 'flv',
              url: streamUrl,
              isLive: true,
            } as mpegts.MediaDataSource);
            player.attachMediaElement(video);
            player.load();
            player.play();
            mpegtsRef.current = player;
          },
        };
        options.type = 'flv';
      } else if (format === 'webrtc') {
        options.customType = {
          webrtc: async (video: HTMLVideoElement, whepUrl: string) => {
            try {
              const pc = await playWebRTC(video, whepUrl);
              pcRef.current = pc;
              video.play().catch(() => {
                // Autoplay may be blocked — Artplayer's play button will pick it up.
              });
            } catch (err) {
              console.error('WebRTC play error:', err);
            }
          },
        };
        options.type = 'webrtc';
      }

      const art = new Artplayer(options);
      artRef.current = art;

      return () => {
        mpegtsRef.current?.destroy();
        mpegtsRef.current = null;
        pcRef.current?.close();
        pcRef.current = null;
        if (artRef.current) {
          artRef.current.destroy();
          artRef.current = null;
        }
      };
    }
  }, [url, format, showPlaceholder, placeholderUrl, placeholderMediaType, chatEnabled]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        aspectRatio: '16 / 9',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#000',
        ...style,
      }}
    />
  );
};

export default LivePlayer;
