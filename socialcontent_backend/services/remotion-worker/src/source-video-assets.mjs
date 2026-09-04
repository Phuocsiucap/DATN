import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = Number(process.env.SOURCE_VIDEO_DOWNLOAD_TIMEOUT_MS || 5 * 60 * 1000);

export function remoteVideoSources(story) {
  const found = [];
  const add = (holder, field, type) => {
    const sourceUrl = unwrapMediaProxyUrl(holder?.[field]);
    if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return;
    if (!String(type || '').toLowerCase().includes('video') && !/\.(?:m3u8|mp4|webm|mov|m4v)(?:[?#]|$)/i.test(sourceUrl)) return;
    found.push({holder, field, sourceUrl});
  };

  const timeline = story?.timeline && typeof story.timeline === 'object' ? story.timeline : {};
  for (const clip of Array.isArray(timeline.video) ? timeline.video : []) {
    if (clip && typeof clip === 'object') add(clip, 'src', clip.type);
  }
  for (const scene of Array.isArray(story?.story_data) ? story.story_data : []) {
    if (scene && typeof scene === 'object') add(scene, 'image', scene.media_type || scene.type);
  }
  return found;
}

export async function materializeRemoteVideoSources(story, {
  publicDir,
  publicUrlFor,
  onHeartbeat,
  materialize = transmuxRemoteVideo,
} = {}) {
  const references = remoteVideoSources(story);
  if (references.length === 0) return {downloaded: 0, reused: 0};
  if (!publicDir || typeof publicUrlFor !== 'function') {
    throw new Error('Render-time source video materialization is not configured.');
  }

  const videoDir = path.join(publicDir, 'assets', 'videos');
  await fs.mkdir(videoDir, {recursive: true});
  const resolved = new Map();
  let downloaded = 0;
  let reused = 0;

  for (const reference of references) {
    let asset = resolved.get(reference.sourceUrl);
    if (!asset) {
      const digest = createHash('sha256').update(reference.sourceUrl).digest('hex').slice(0, 20);
      const relativePath = `assets/videos/source-${digest}.mp4`;
      const destination = path.join(publicDir, ...relativePath.split('/'));
      if (await isUsableFile(destination)) {
        reused += 1;
      } else {
        await materialize(reference.sourceUrl, destination, {onHeartbeat});
        downloaded += 1;
      }
      const publicUrl = publicUrlFor(relativePath);
      if (!publicUrl) throw new Error(`Cannot expose render source asset ${relativePath}`);
      asset = {relativePath, publicUrl};
      resolved.set(reference.sourceUrl, asset);
    }
    reference.holder.source_url = reference.sourceUrl;
    reference.holder.storage_url = asset.relativePath;
    reference.holder[reference.field] = asset.publicUrl;
  }
  return {downloaded, reused};
}

export async function transmuxRemoteVideo(sourceUrl, destination, {onHeartbeat} = {}) {
  const temporary = `${destination}.part.mp4`;
  await fs.rm(temporary, {force: true});
  const headers = `Referer: ${refererFor(sourceUrl)}\r\nUser-Agent: Mozilla/5.0\r\n`;
  const args = [
    '-nostdin', '-y', '-loglevel', 'error',
    '-headers', headers,
    '-i', sourceUrl,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c', 'copy', '-movflags', '+faststart',
    temporary,
  ];

  try {
    await runProcess('ffmpeg', args, {timeoutMs: DEFAULT_TIMEOUT_MS, onHeartbeat});
    if (!await isUsableFile(temporary)) throw new Error('ffmpeg produced an empty source video.');
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, {force: true});
    throw new Error(`Cannot prepare source video for render: ${error.message}`);
  }
}

function unwrapMediaProxyUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const nested = parsed.pathname.endsWith('/media-proxy') ? parsed.searchParams.get('url') : null;
    return nested || raw;
  } catch {
    return raw;
  }
}

function refererFor(sourceUrl) {
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase();
    if (hostname.endsWith('vnecdn.net')) return 'https://vnexpress.net/';
    return `https://${hostname}/`;
  } catch {
    return 'https://vnexpress.net/';
  }
}

async function isUsableFile(filePath) {
  try {
    return (await fs.stat(filePath)).size > 0;
  } catch {
    return false;
  }
}

function runProcess(command, args, {timeoutMs, onHeartbeat}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {windowsHide: true});
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    const heartbeat = onHeartbeat ? setInterval(() => void Promise.resolve(onHeartbeat()).catch(() => undefined), 3000) : null;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
    child.once('exit', () => {
      clearTimeout(timeout);
      if (heartbeat) clearInterval(heartbeat);
    });
  });
}
