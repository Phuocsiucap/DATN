import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import path from 'node:path';
import process from 'node:process';

const compositionId = process.env.GENERATE_VIDEO_REMOTION_COMPOSITION_ID || 'StorytellingDemo';
const publicDir = process.env.REMOTION_PUBLIC_DIR || '/app/data_demo/video_gen_demo/public';
let bundledServeUrl;

export async function renderStory({story, outputPath}) {
  if (!outputPath) {
    throw new Error('Missing output path for Remotion render');
  }
  const inputProps = {story: story || {}};
  const serveUrl = await getServeUrl();
  const composition = await selectComposition({
    serveUrl,
    id: compositionId,
    inputProps,
    browserExecutable: browserExecutable(),
  });

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: path.resolve(outputPath),
    inputProps,
    overwrite: true,
    concurrency: optionalNumber(process.env.GENERATE_VIDEO_REMOTION_CONCURRENCY),
    crf: optionalNumber(process.env.GENERATE_VIDEO_REMOTION_CRF) ?? 23,
    x264Preset: process.env.GENERATE_VIDEO_REMOTION_X264_PRESET || 'veryfast',
    browserExecutable: browserExecutable(),
  });
}

async function getServeUrl() {
  if (!bundledServeUrl) {
    bundledServeUrl = await bundle({
      entryPoint: path.resolve(process.cwd(), 'src/remotion/index.ts'),
      publicDir,
    });
  }
  return bundledServeUrl;
}

function browserExecutable() {
  return process.env.CHROME_BIN || process.env.CHROMIUM_BIN || null;
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outputPath = process.argv[2];
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  const payload = raw ? JSON.parse(raw) : {};
  await renderStory({story: payload.story || payload.props?.story || {}, outputPath});
  console.log(JSON.stringify({ok: true, outputPath: path.resolve(outputPath)}));
}
