import os
import urllib.parse
from datetime import datetime

import yt_dlp
import imageio_ffmpeg

def extract_video_url(embed_url: str) -> str:
    """Extract the raw video url (e.g. m3u8) from an embed url."""
    parsed = urllib.parse.urlparse(embed_url)
    queries = urllib.parse.parse_qs(parsed.query)
    if 'file' in queries:
        return urllib.parse.unquote(queries['file'][0])
    return embed_url

from pathlib import Path

# Tìm đường dẫn gốc của project (D:\DATN)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
TEMP_DIR = PROJECT_ROOT / "temp"

import hashlib

def download_video(video_url: str) -> str:
    """Download video using yt-dlp and ffmpeg, returns the path to the downloaded mp4."""
    ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
    
    os.makedirs(TEMP_DIR, exist_ok=True)
    # Dùng mã hash của URL để làm tên file, tránh tải lại nhiều lần cho cùng 1 video
    url_hash = hashlib.md5(video_url.encode('utf-8')).hexdigest()
    filename = str(TEMP_DIR / f"video_{url_hash}.mp4")
    
    # Nếu file đã tồn tại (ví dụ đã tải cho Facebook trước đó), thì dùng luôn
    if os.path.exists(filename):
        print(f"[*] Video đã được tải trước đó, sử dụng lại: {filename}")
        return filename
    
    ydl_opts = {
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'outtmpl': filename,
        'quiet': True,
        'no_warnings': True,
        'ffmpeg_location': ffmpeg_path
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([video_url])
    return filename
