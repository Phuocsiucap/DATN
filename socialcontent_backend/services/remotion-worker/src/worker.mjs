import {Kafka} from 'kafkajs';
import {Pool} from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {renderStory} from './render.mjs';

const RENDER_TOPIC = 'generate-video.render.requested';
const WORKER_ID = process.env.WORKER_ID || `remotion-worker-${process.pid}`;
const POLL_INTERVAL_MS = Number(process.env.REMOTION_WORKER_POLL_INTERVAL_MS || 5000);
const TASK_STALE_MINUTES = Number(process.env.REMOTION_WORKER_STALE_MINUTES || 20);
const PUBLIC_DIR = process.env.REMOTION_PUBLIC_DIR || '/app/data_demo/video_gen_demo/public';
const OUT_DIR = process.env.REMOTION_OUT_DIR || '/app/data_demo/video_gen_demo/out';

const pool = new Pool({
  connectionString: nodePostgresUrl(process.env.DATABASE_URL),
});

async function main() {
  await fs.mkdir(OUT_DIR, {recursive: true});
  await recoverStaleRenderTasks();
  await processPendingRenderTasks();

  if (String(process.env.DISABLE_KAFKA || '').toLowerCase() === 'true') {
    console.log('Kafka disabled; remotion-worker using DB polling');
    await pollForever();
    return;
  }

  try {
    const kafka = new Kafka({
      clientId: 'socialcontent-remotion-worker',
      brokers: kafkaBrokers(),
    });
    const consumer = kafka.consumer({groupId: 'generate-video-render-workers'});
    await consumer.connect();
    await consumer.subscribe({topic: RENDER_TOPIC, fromBeginning: true});
    console.log(`remotion-worker subscribed to ${RENDER_TOPIC}`);
    await consumer.run({
      eachMessage: async ({message}) => {
        await processPendingRenderTasks();
        const event = parseKafkaValue(message.value);
        const jobId = event?.job_id || event?.payload?.task_id || event?.payload?.run_id;
        if (jobId) {
          await processRenderTask(String(jobId));
        }
      },
    });
  } catch (error) {
    console.warn(`[Kafka Warning] remotion-worker falling back to DB polling: ${error.message}`);
    await pollForever();
  }
}

async function pollForever() {
  while (true) {
    await recoverStaleRenderTasks();
    await processPendingRenderTasks();
    await sleep(POLL_INTERVAL_MS);
  }
}

async function processPendingRenderTasks() {
  const {rows} = await pool.query(
    `
      SELECT id
      FROM kafka_tasks
      WHERE task_type = 'GENERATE_VIDEO_RENDER'
        AND status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT 10
    `,
  );
  for (const row of rows) {
    await processRenderTask(row.id);
  }
}

async function recoverStaleRenderTasks() {
  await pool.query(
    `
      UPDATE kafka_tasks
      SET status = 'PENDING',
          current_stage = 'QUEUED_RETRY',
          progress_percent = 0,
          completed_at = NULL,
          error_message = 'Recovered stale RUNNING render task for remotion-worker retry.'
      WHERE task_type = 'GENERATE_VIDEO_RENDER'
        AND status IN ('RUNNING', 'PROCESSING')
        AND started_at IS NOT NULL
        AND started_at < NOW() - ($1::int * INTERVAL '1 minute')
    `,
    [TASK_STALE_MINUTES],
  );
}

async function processRenderTask(taskId) {
  const claimed = await claimRenderTask(taskId);
  if (!claimed) {
    return;
  }
  const {task, project} = claimed;

  try {
    const story = normalizeStoryForRender(project.draft_json, project.id);
    const outputName = outputNameFor(project.id, task.id);
    const outputPath = path.join(OUT_DIR, outputName);
    const artifactPath = `out/${outputName}`;

    await updateProgress(task.id, project.id, 'RENDERING_VIDEO', 30, 'RENDERING');
    await renderStory({story, outputPath});

    story.video_artifacts = {...(story.video_artifacts || {}), final: artifactPath};
    const publicStory = publicStoryPayload(story, project.id, artifactPath);

    await updateProgress(task.id, project.id, 'SAVING_VIDEO', 95, 'RENDERING');
    await completeRenderTask({task, project, artifactPath, publicStory});
  } catch (error) {
    await failRenderTask(task.id, project.id, error);
  }
}

async function claimRenderTask(taskId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taskResult = await client.query(
      `
        SELECT *
        FROM kafka_tasks
        WHERE id = $1
          AND task_type = 'GENERATE_VIDEO_RENDER'
          AND status IN ('PENDING', 'FAILED')
        FOR UPDATE
      `,
      [taskId],
    );
    const task = taskResult.rows[0];
    if (!task) {
      await client.query('ROLLBACK');
      return null;
    }

    const projectResult = await client.query('SELECT * FROM media_workflow WHERE id = $1 FOR UPDATE', [task.reference_id]);
    const project = projectResult.rows[0];
    if (!project) {
      await client.query('ROLLBACK');
      return null;
    }

    const blockingResult = await client.query(
      `
        SELECT task_type
        FROM kafka_tasks
        WHERE reference_id = $1
          AND task_type = ANY($2::text[])
          AND status = ANY($3::text[])
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [
        project.id,
        ['GENERATE_VIDEO_SCRIPT', 'GENERATE_VIDEO_EDIT', 'GENERATE_VIDEO_REVIEW', 'GENERATE_VIDEO_VOICE'],
        ['PENDING', 'RUNNING', 'PROCESSING'],
      ],
    );
    const blockingTask = blockingResult.rows[0];
    if (blockingTask) {
      const stage = blockingTask.task_type === 'GENERATE_VIDEO_VOICE' ? 'QUEUED_RENDER_AFTER_VOICE' : 'QUEUED_RENDER_AFTER_DRAFT';
      await client.query(
        `
          UPDATE kafka_tasks
          SET current_stage = $2,
              progress_percent = 0
          WHERE id = $1
        `,
        [task.id, stage],
      );
      await client.query('COMMIT');
      return null;
    }

    await client.query(
      `
        UPDATE kafka_tasks
        SET status = 'RUNNING',
            started_at = NOW(),
            completed_at = NULL,
            error_message = NULL,
            locked_by = $2,
            heartbeat_at = NOW()
        WHERE id = $1
      `,
      [task.id, WORKER_ID],
    );
    await updateProgressInTransaction(client, task.id, project.id, 'PREPARING_RENDER', 10, 'RENDERING');
    await client.query('COMMIT');
    return {task, project};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateProgress(taskId, projectId, stage, percent, projectStatus) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await updateProgressInTransaction(client, taskId, projectId, stage, percent, projectStatus);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateProgressInTransaction(client, taskId, projectId, stage, percent, projectStatus) {
  await client.query(
    `
      UPDATE kafka_tasks
      SET current_stage = $2,
          progress_percent = $3,
          heartbeat_at = NOW()
      WHERE id = $1
    `,
    [taskId, stage, percent],
  );
  await client.query(
    `
      UPDATE media_workflow
      SET current_stage = $2,
          progress_percent = $3,
          status = COALESCE($4, status),
          updated_at = NOW()
      WHERE id = $1
    `,
    [projectId, stage, percent, projectStatus],
  );
}

async function completeRenderTask({task, project, artifactPath, publicStory}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const artifacts = Array.isArray(project.artifacts_jsonb) ? project.artifacts_jsonb : [];
    artifacts.push({
      artifact_type: 'FINAL_VIDEO',
      uri: artifactPath,
      status: 'READY',
      metadata: {task_id: task.id},
      created_at: new Date().toISOString(),
    });
    const policy = await applyModule4Policy(client, project, publicStory, artifactPath);

    await client.query(
      `
        UPDATE kafka_tasks
        SET status = 'COMPLETED',
            progress_percent = 100,
            current_stage = 'RENDERED',
            result_jsonb = $2::jsonb,
            completed_at = NOW(),
            heartbeat_at = NOW()
        WHERE id = $1
      `,
      [task.id, JSON.stringify({output_path: artifactPath, workflow_id: project.id})],
    );
    await client.query(
      `
        UPDATE media_workflow
        SET status = $2,
            current_stage = $3,
            progress_percent = 100,
            draft_json = $4::jsonb,
            artifacts_jsonb = $5::jsonb,
            metadata = $6::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        project.id,
        policy.projectStatus,
        policy.currentStage,
        JSON.stringify(publicStory),
        JSON.stringify(artifacts),
        JSON.stringify(policy.metadata),
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function failRenderTask(taskId, projectId, error) {
  const message = String(error?.message || error || 'Render failed').slice(-2000);
  await pool.query(
    `
      UPDATE kafka_tasks
      SET status = 'FAILED',
          current_stage = 'FAILED',
          error_message = $2,
          completed_at = NOW(),
          heartbeat_at = NOW()
      WHERE id = $1
    `,
    [taskId, message],
  );
  await pool.query(
    `
      UPDATE media_workflow
      SET status = 'FAILED',
          current_stage = 'FAILED',
          updated_at = NOW()
      WHERE id = $1
    `,
    [projectId],
  );
}

function normalizeStoryForRender(value, workflowId) {
  const story = cloneJson(value || {});
  story.meta = {...(story.meta || {}), workflow_id: String(workflowId)};
  story.timeline = normalizeTimeline(story);
  return story;
}

function normalizeTimeline(story) {
  const fps = Number(story?.video?.fps || 30);
  const timeline = story.timeline && typeof story.timeline === 'object' ? {...story.timeline} : {};
  if (!Array.isArray(timeline.video) && Array.isArray(story.story_data)) {
    return timelineFromLegacyScenes(story.story_data, fps, story);
  }
  const video = normalizeClips(timeline.video || [], fps);
  const text = normalizeClips(timeline.text || [], fps).map((clip) => ({
    ...clip,
    type: clip.type || 'subtitle',
    text: stripVoiceTags(String(clip.text || '')),
  }));
  const audio = normalizeClips(timeline.audio || [], fps);
  return {
    ...timeline,
    version: 1,
    duration: roundToFrame(maxTimelineEnd(video, text, audio, Number(timeline.duration || 0)), fps),
    video,
    text,
    audio,
  };
}

function timelineFromLegacyScenes(scenes, fps, story) {
  let cursor = 0;
  const video = [];
  const text = [];
  scenes.forEach((scene, index) => {
    if (!scene || typeof scene !== 'object') {
      return;
    }
    const duration = Math.max(1 / Math.max(1, fps), Number(scene.duration || 4));
    const start = roundToFrame(cursor, fps);
    const end = roundToFrame(cursor + duration, fps);
    const textValue = stripVoiceTags(String(scene.subtitle || ''));
    const videoId = String(scene.id || `video-${index + 1}`);
    const textId = String(scene.text_id || `text-${index + 1}`);
    video.push({
      id: videoId,
      type: 'image',
      start,
      end,
      duration: roundToFrame(end - start, fps),
      src: scene.image || '',
      effect: scene.effect || 'slow-zoom',
      fit: scene.fit === 'cover' ? 'cover' : 'contain',
      scene_index: index,
      ...(textValue ? {text_id: textId, text_ids: [textId]} : {}),
    });
    if (textValue) {
      const textStart = Number(scene.subtitle_start ?? start);
      const textDuration = Number(scene.subtitle_duration ?? duration);
      text.push({
        id: textId,
        video_id: videoId,
        video_ids: [videoId],
        type: 'subtitle',
        start: roundToFrame(textStart, fps),
        end: roundToFrame(textStart + textDuration, fps),
        duration: roundToFrame(textDuration, fps),
        text: textValue,
        scene_index: index,
      });
    }
    cursor = end;
  });
  const audio = normalizeClips(story?.timeline?.audio || [], fps);
  return {
    version: 1,
    duration: roundToFrame(maxTimelineEnd(video, text, audio, cursor), fps),
    video,
    text,
    audio,
  };
}

function publicStoryPayload(story, workflowId, artifactPath) {
  const publicStory = {
    meta: {...(story.meta || {}), workflow_id: String(workflowId)},
    video: story.video,
    audio: story.audio,
    timeline: story.timeline || {},
    video_artifacts: {...(story.video_artifacts || {}), final: artifactPath},
    project_status: 'RENDERED',
  };
  publicStory.global_tracks = story.global_tracks || [];
  return publicStory;
}

function normalizeClips(value, fps) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((clip) => clip && typeof clip === 'object')
    .map((clip, index) => {
      const start = roundToFrame(Math.max(0, Number(clip.start || 0)), fps);
      const fallbackDuration = Number(clip.duration || 4);
      const end = roundToFrame(Math.max(start + 1 / Math.max(1, fps), Number(clip.end ?? start + fallbackDuration)), fps);
      return {
        ...clip,
        id: String(clip.id || `clip-${index + 1}`),
        start,
        end,
        duration: roundToFrame(end - start, fps),
      };
    })
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

async function applyModule4Policy(client, project, story, renderedVideo) {
  const profileResult = await client.query(
    `
      SELECT sp.platform,
             s.approval_mode,
             s.auto_queue_enabled,
             s.auto_publish_enabled,
             s.schedule_enabled,
             s.schedule_days,
             s.schedule_times
      FROM social_profiles sp
      LEFT JOIN social_profile_strategies s ON s.profile_id = sp.id
      WHERE sp.id = $1
      LIMIT 1
    `,
    [project.profile_id],
  );
  const profile = profileResult.rows[0] || {};
  const metadata = {
    ...(project.metadata || {}),
    module4_quality: {
      status: 'passed_basic_render_check',
      checked_at: new Date().toISOString(),
      checks: ['final_video_exists', 'render_task_completed'],
    },
  };

  if (profile.approval_mode !== 'auto') {
    metadata.module4_review = {
      decision: 'waiting_human_review',
      mode: 'manual',
      reason: 'Social profile strategy requires manual approval',
    };
    return {metadata, projectStatus: 'RENDERED', currentStage: 'WAITING_HUMAN_REVIEW'};
  }

  metadata.video_approved = true;
  metadata.video_approved_at = new Date().toISOString();
  metadata.module4_review = {
    decision: 'approved',
    mode: 'auto',
    reason: 'Social profile strategy approval_mode=auto',
  };

  if (profile.auto_queue_enabled === false) {
    return {metadata, projectStatus: 'VIDEO_APPROVED', currentStage: 'AUTO_APPROVED'};
  }

  const queuedReason = 'Module 4 auto queue từ video render đã được duyệt tự động';
  const existingId = metadata.queued_post_id;
  let queueItem = null;
  if (existingId) {
    const existing = await client.query('SELECT * FROM publishing_queue_items WHERE id = $1 LIMIT 1', [existingId]);
    queueItem = existing.rows[0] || null;
  }

  const scheduledAt = nextStrategyScheduledAt(profile);
  const generatedContent = defaultModule4Caption(project, story);
  if (!queueItem) {
    const created = await client.query(
      `
        INSERT INTO publishing_queue_items (
          user_id,
          profile_id,
          content_id,
          article_link,
          article_title,
          platform,
          generated_content,
          ai_reason,
          status,
          scheduled_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved', $9)
        RETURNING *
      `,
      [
        project.user_id,
        project.profile_id,
        project.primary_content_id,
        renderedVideo,
        project.title,
        profile.platform || 'tiktok',
        generatedContent,
        queuedReason,
        scheduledAt,
      ],
    );
    queueItem = created.rows[0];
  } else {
    const updated = await client.query(
      `
        UPDATE publishing_queue_items
        SET article_link = $2,
            article_title = $3,
            generated_content = COALESCE(NULLIF(generated_content, ''), $4),
            ai_reason = $5,
            status = 'approved',
            scheduled_at = COALESCE(scheduled_at, $6),
            error = NULL,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [queueItem.id, renderedVideo, project.title, generatedContent, queuedReason, scheduledAt],
    );
    queueItem = updated.rows[0];
  }

  metadata.queued_post_id = String(queueItem.id);
  metadata.queued_at = new Date().toISOString();
  metadata.module4_queue = {
    status: queueItem.status,
    scheduled_at: queueItem.scheduled_at ? new Date(queueItem.scheduled_at).toISOString() : null,
    auto_publish_enabled: Boolean(profile.auto_publish_enabled),
    reason: queuedReason,
  };
  return {metadata, projectStatus: 'QUEUED_FOR_PUBLISHING', currentStage: 'QUEUED_FOR_PUBLISHING'};
}

function nextStrategyScheduledAt(strategy) {
  const now = new Date();
  const times = String(strategy.schedule_times || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const days = new Set(
    String(strategy.schedule_days || '0,1,2,3,4,5,6')
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item)),
  );
  if (strategy.schedule_enabled === false || times.length === 0) {
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const candidateDay = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const pythonWeekday = (candidateDay.getDay() + 6) % 7;
    if (days.size > 0 && !days.has(pythonWeekday)) {
      continue;
    }
    for (const value of times) {
      const [hour, minute] = value.split(':').map((part) => Number(part));
      if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
        continue;
      }
      const candidate = new Date(candidateDay);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate > now) {
        return candidate;
      }
    }
  }
  return new Date(now.getTime() + 60 * 60 * 1000);
}

function defaultModule4Caption(project, story) {
  const title = String(story?.meta?.title || project.title || '').trim();
  return title || 'Video mới đã sẵn sàng đăng';
}

function outputNameFor(workflowId, taskId) {
  const renderKey = String(taskId).replaceAll('-', '').slice(0, 12);
  return `final-${workflowId}-${renderKey}.mp4`;
}

function maxTimelineEnd(video, text, audio, fallback) {
  return Math.max(
    0,
    fallback || 0,
    ...video.map((clip) => Number(clip.end || 0)),
    ...text.map((clip) => Number(clip.end || 0)),
    ...audio.map((clip) => Number(clip.end || 0)),
  );
}

function roundToFrame(value, fps) {
  return Math.round(Number(value || 0) * Math.max(1, fps)) / Math.max(1, fps);
}

function stripVoiceTags(text) {
  return text
    .replace(/\[[^\]]*voice[^\]]*\]/gi, '')
    .replace(/<[^>]*voice[^>]*>/gi, '')
    .trim();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function parseKafkaValue(value) {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value.toString('utf8'));
  } catch {
    return {};
  }
}

function kafkaBrokers() {
  return String(process.env.KAFKA_BOOTSTRAP_SERVERS || 'kafka:29092')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function nodePostgresUrl(value) {
  return String(value || '').replace(/^postgresql\+[^:]+:\/\//, 'postgresql://');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => {});
  process.exit(1);
});
