import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {materializeRemoteVideoSources, remoteVideoSources} from './source-video-assets.mjs';

test('finds remote HLS video clips but ignores images', () => {
  const story = {
    timeline: {
      video: [
        {id: 'video-1', type: 'video', src: 'https://cdn.example.test/master.m3u8'},
        {id: 'image-1', type: 'image', src: 'https://cdn.example.test/poster.jpg'},
      ],
    },
  };
  assert.deepEqual(remoteVideoSources(story).map((item) => item.sourceUrl), [
    'https://cdn.example.test/master.m3u8',
  ]);
});

test('materializes each selected remote video once and rewrites clips to local assets', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'source-video-assets-'));
  try {
    const sourceUrl = 'https://cdn.example.test/master.m3u8';
    const story = {
      timeline: {
        video: [
          {id: 'video-1', type: 'video', src: sourceUrl},
          {id: 'video-2', type: 'video', src: sourceUrl},
        ],
      },
    };
    let calls = 0;
    const result = await materializeRemoteVideoSources(story, {
      publicDir: tempDir,
      publicUrlFor: (relativePath) => `http://assets.local/${relativePath}`,
      materialize: async (_source, destination) => {
        calls += 1;
        await fs.writeFile(destination, 'video');
      },
    });

    assert.equal(calls, 1);
    assert.equal(result.downloaded, 1);
    for (const clip of story.timeline.video) {
      assert.equal(clip.source_url, sourceUrl);
      assert.match(clip.storage_url, /^assets\/videos\/source-[a-f0-9]{20}\.mp4$/);
      assert.equal(clip.src, `http://assets.local/${clip.storage_url}`);
    }
  } finally {
    await fs.rm(tempDir, {recursive: true, force: true});
  }
});
