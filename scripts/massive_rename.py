import os
import re

BACKEND_DIR = r"d:\DATN\socialcontent_backend"
FRONTEND_DIR = r"d:\DATN\frontend"

REPLACEMENTS = {
    # Exact case matches
    "ContentProject": "MediaWorkflow",
    "content_projects": "media_workflows",
    "content_project": "media_workflow",
    "content-projects": "media-workflows",
    "content-project": "media-workflow",
    "Content Project": "Media Workflow",
    "Content Projects": "Media Workflows",

    "ProjectSeries": "ContentSeries",
    "project_series": "content_series",
    "project-series": "content-series",
    
    "ProjectRun": "WorkflowRun",
    "project_runs": "workflow_runs",
    "project_run": "workflow_run",
    "project-run": "workflow-run",
    
    "ProjectPart": "WorkflowPart",
    "project_parts": "workflow_parts",
    "project_part": "workflow_part",
    
    "ProjectSource": "WorkflowSource",
    "project_sources": "workflow_sources",
    "project_source": "workflow_source",
    
    "ProjectCandidate": "WorkflowCandidate",
    "project_candidates": "workflow_candidates",
    "project_candidate": "workflow_candidate",
    
    "ProjectArtifact": "WorkflowArtifact",
    "project_artifacts": "workflow_artifacts",
    "project_artifact": "workflow_artifact",
    
    "project_id": "workflow_id",
    "projectId": "workflowId",
    "project_run_id": "workflow_run_id",
    "projectRunId": "workflowRunId",
}

def process_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return False

    original_content = content
    for old, new in REPLACEMENTS.items():
        content = content.replace(old, new)
        
    if content != original_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated: {filepath}")
        return True
    return False

def rename_files_and_directories(root_dir):
    # Rename from bottom up to avoid path issues
    for dirpath, dirnames, filenames in os.walk(root_dir, topdown=False):
        if "node_modules" in dirpath or ".next" in dirpath or ".git" in dirpath or "__pycache__" in dirpath:
            continue
            
        for filename in filenames:
            new_filename = filename
            for old, new in REPLACEMENTS.items():
                if old in new_filename:
                    new_filename = new_filename.replace(old, new)
            
            if new_filename != filename:
                old_path = os.path.join(dirpath, filename)
                new_path = os.path.join(dirpath, new_filename)
                os.rename(old_path, new_path)
                print(f"Renamed file: {old_path} -> {new_path}")
                
        for dirname in dirnames:
            new_dirname = dirname
            for old, new in REPLACEMENTS.items():
                if old in new_dirname:
                    new_dirname = new_dirname.replace(old, new)
            
            if new_dirname != dirname:
                old_path = os.path.join(dirpath, dirname)
                new_path = os.path.join(dirpath, new_dirname)
                os.rename(old_path, new_path)
                print(f"Renamed dir: {old_path} -> {new_path}")

def update_content(root_dir):
    extensions = {'.py', '.tsx', '.ts', '.js', '.jsx', '.json', '.yaml', '.yml'}
    for dirpath, _, filenames in os.walk(root_dir):
        if "node_modules" in dirpath or ".next" in dirpath or ".git" in dirpath or "__pycache__" in dirpath:
            continue
        for filename in filenames:
            if any(filename.endswith(ext) for ext in extensions):
                process_file(os.path.join(dirpath, filename))

print("Starting Refactoring...")
update_content(BACKEND_DIR)
update_content(FRONTEND_DIR)
rename_files_and_directories(BACKEND_DIR)
rename_files_and_directories(FRONTEND_DIR)
print("Finished massive rename.")
