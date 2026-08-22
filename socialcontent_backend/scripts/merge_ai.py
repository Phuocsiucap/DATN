import os
import shutil
import re

base_dir = r"d:\DATN\socialcontent_backend\services"
dest_service = os.path.join(base_dir, "ai-media-engine")

services_to_merge = {
    "planning-orchestrator": "planning",
    "generate-video-service": "video",
}

app_dest = os.path.join(dest_service, "app")
os.makedirs(app_dest, exist_ok=True)
with open(os.path.join(app_dest, "__init__.py"), "w") as f:
    pass

for src_folder, sub_pkg in services_to_merge.items():
    src_app = os.path.join(base_dir, src_folder, "app")
    dest_pkg = os.path.join(app_dest, sub_pkg)
    
    if os.path.exists(dest_pkg):
        shutil.rmtree(dest_pkg)
        
    shutil.copytree(src_app, dest_pkg)
    
    for root, _, files in os.walk(dest_pkg):
        for file in files:
            if file.endswith(".py"):
                filepath = os.path.join(root, file)
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
                
                content = re.sub(r'^from app\.', f'from app.{sub_pkg}.', content, flags=re.MULTILINE)
                content = re.sub(r'^import app\.', f'import app.{sub_pkg}.', content, flags=re.MULTILINE)
                
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(content)

embed_main = os.path.join(base_dir, "embedding-service", "app", "main.py")
dest_embed = os.path.join(app_dest, "embeddings.py")
shutil.copy(embed_main, dest_embed)

print("AI Media Engine merged successfully.")
