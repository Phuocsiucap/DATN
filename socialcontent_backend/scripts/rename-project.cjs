const fs = require('fs');
const file = 'd:/DATN/socialcontent_backend/common/db/media_workflows.py';
let content = fs.readFileSync(file, 'utf8');

// Replace function names
content = content.replace(/_find_project/g, '_find_workflow');
content = content.replace(/sync_project_from_plan/g, 'sync_workflow_from_plan');
content = content.replace(/_primary_project_content/g, '_primary_workflow_content');
content = content.replace(/_persist_project_story/g, '_persist_workflow_story');
content = content.replace(/_maybe_enqueue_auto_project_render/g, '_maybe_enqueue_auto_workflow_render');
content = content.replace(/_enqueue_project_render_job/g, '_enqueue_workflow_render_job');
content = content.replace(/_project_status/g, '_workflow_status');
content = content.replace(/_find_video_draft_for_project/g, '_find_video_draft_for_workflow');
content = content.replace(/_upsert_project_video_draft/g, '_upsert_workflow_video_draft');
content = content.replace(/serialize_project = serialize_workflow/g, '');

// Replace variable names
// project -> workflow (where appropriate, simple regex word boundary replacement)
content = content.replace(/\bproject\b/g, 'workflow');
content = content.replace(/\bProject\b/g, 'Workflow');
content = content.replace(/\bPROJECT\b/g, 'WORKFLOW');

fs.writeFileSync(file, content);
console.log('Renamed project to workflow');
