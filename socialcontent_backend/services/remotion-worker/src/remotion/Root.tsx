import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Composition,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

type Clip = {
  id?: string;
  type?: string;
  start?: number;
  end?: number;
  duration?: number;
  src?: string;
  text?: string;
  volume?: number;
  effect?: string;
  fit?: 'cover' | 'contain' | string;
};

type Story = {
  meta?: Record<string, unknown>;
  video?: {fps?: number};
  audio?: {
    voice?: string;
    voiceVolume?: number;
    voiceDuration?: number;
    music?: string;
    musicVolume?: number;
    musicDuration?: number;
  };
  timeline?: {
    duration?: number;
    video?: Clip[];
    text?: Clip[];
    audio?: Clip[];
  };
};

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="StorytellingDemo"
      component={StorytellingDemo}
      durationInFrames={FPS * 30}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{story: {}}}
      calculateMetadata={({props}) => {
        const seconds = getDurationSeconds((props as {story?: Story}).story);
        return {durationInFrames: Math.max(FPS, Math.ceil(seconds * FPS))};
      }}
    />
  );
};

const StorytellingDemo: React.FC<{story?: Story}> = ({story}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const seconds = frame / fps;
  const timeline = story?.timeline || {};
  const videoClips = Array.isArray(timeline.video) ? timeline.video : [];
  const textClips = Array.isArray(timeline.text) ? timeline.text : [];
  const audioClips = resolveAudioClips(story);
  const activeVideo = findActiveClip(videoClips, seconds);
  const activeText = findActiveClip(textClips, seconds);
  const title = String(story?.meta?.title || story?.meta?.workflow_title || 'SocialContentHub');
  const subtitle = String(activeText?.text || title);
  const imageSrc = resolveVisualSrc(activeVideo?.src);
  const zoom = interpolate(frame, [0, fps * 8], [1, 1.06], {extrapolateRight: 'extend'});
  const tint = colorFromText(title);

  return (
    <AbsoluteFill style={{backgroundColor: '#08090d', fontFamily: 'Inter, Arial, sans-serif'}}>
      <AbsoluteFill style={fallbackBackground(tint)} />
      {imageSrc ? (
        <AbsoluteFill
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'center',
          }}
        >
          <Img
            src={imageSrc}
            style={{
              width: '100%',
              height: '100%',
              objectFit: activeVideo?.fit === 'contain' ? 'contain' : 'cover',
            }}
          />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.24) 42%, rgba(0,0,0,0.78) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 70,
          right: 70,
          bottom: 168,
          color: 'white',
          textAlign: 'center',
          fontSize: subtitle.length > 96 ? 50 : 62,
          lineHeight: 1.14,
          fontWeight: 850,
          letterSpacing: 0,
          textShadow: '0 8px 28px rgba(0,0,0,0.72)',
          overflowWrap: 'break-word',
        }}
      >
        {subtitle}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 76,
          right: 76,
          bottom: 90,
          height: 10,
          borderRadius: 999,
          backgroundColor: 'rgba(255,255,255,0.22)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.min(100, (seconds / Math.max(1, getDurationSeconds(story))) * 100)}%`,
            height: '100%',
            backgroundColor: '#ffffff',
          }}
        />
      </div>
      {audioClips.map((clip, index) => {
        const src = resolvePublicAsset(clip.src);
        if (!src) {
          return null;
        }
        const from = Math.max(0, Math.round((clip.start || 0) * fps));
        const duration = clip.end ? Math.max(1, Math.round(((clip.end || 0) - (clip.start || 0)) * fps)) : undefined;
        return (
          <Sequence key={clip.id || `audio-${index}`} from={from} durationInFrames={duration}>
            <Audio src={src} volume={clip.volume ?? 1} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

function resolveAudioClips(story?: Story): Clip[] {
  const timelineAudio = Array.isArray(story?.timeline?.audio) ? story?.timeline?.audio || [] : [];
  if (timelineAudio.length > 0) {
    return timelineAudio.filter((clip) => clip?.src);
  }
  const clips: Clip[] = [];
  if (story?.audio?.voice) {
    clips.push({
      id: 'voice-main',
      type: 'voice',
      start: 0,
      end: story.audio.voiceDuration,
      src: story.audio.voice,
      volume: story.audio.voiceVolume ?? 1,
    });
  }
  if (story?.audio?.music) {
    clips.push({
      id: 'music-main',
      type: 'music',
      start: 0,
      end: story.audio.musicDuration,
      src: story.audio.music,
      volume: story.audio.musicVolume ?? 0.12,
    });
  }
  return clips;
}

function findActiveClip(clips: Clip[], seconds: number): Clip | undefined {
  for (const clip of clips) {
    const start = Number(clip.start || 0);
    const end = Number(clip.end || start + (clip.duration || 4));
    if (seconds >= start && seconds < end) {
      return clip;
    }
  }
  return clips[clips.length - 1];
}

function getDurationSeconds(story?: Story): number {
  const timeline = story?.timeline || {};
  const clips = [...(timeline.video || []), ...(timeline.text || []), ...(timeline.audio || [])];
  const clipEnd = clips.reduce((max, clip) => {
    const start = Number(clip.start || 0);
    const end = Number(clip.end || start + (clip.duration || 0));
    return Math.max(max, end);
  }, 0);
  return Math.max(4, Number(timeline.duration || 0), clipEnd, Number(story?.audio?.voiceDuration || 0));
}

function resolveVisualSrc(src?: string): string | null {
  const value = String(src || '').trim();
  if (!value || value.startsWith('assets/images/')) {
    return null;
  }
  return resolvePublicAsset(value);
}

function resolvePublicAsset(src?: string): string | null {
  const value = String(src || '').trim();
  if (!value) {
    return null;
  }
  if (/^(https?:|data:|blob:|file:)/i.test(value)) {
    return value;
  }
  if (/^[a-zA-Z]:[\\/]/.test(value)) {
    return `file:///${value.replace(/\\/g, '/')}`;
  }
  return staticFile(value.replace(/^public[\\/]/, '').replace(/\\/g, '/'));
}

function fallbackBackground(seed: string): React.CSSProperties {
  return {
    background: `linear-gradient(145deg, ${seed} 0%, #101828 42%, #121212 100%)`,
  };
}

function colorFromText(text: string): string {
  let hash = 0;
  for (const char of text) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return `hsl(${hash}, 54%, 26%)`;
}
