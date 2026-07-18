from __future__ import annotations

import shutil
import subprocess
import re
from pathlib import Path
from typing import Any


class VideoRenderer:
    def render_job_outputs(
        self,
        video_path: Path,
        srt_path: Path,
        job_dir: Path,
        *,
        title: str,
        subtitle_style: dict[str, Any] | None = None,
        segment_seconds: int = 150,
        min_split_seconds: int = 240,
    ) -> dict[str, Any]:
        job_dir.mkdir(parents=True, exist_ok=True)
        parts_dir = job_dir / "parts"
        clear_generated_parts(parts_dir)

        full_video = job_dir / "full.subbed.mp4"
        style = normalize_subtitle_style(subtitle_style)
        self.render_hardsub(video_path, srt_path, full_video, style=style)
        duration = self.probe_duration(full_video) or self.probe_duration(video_path)

        if duration and duration > min_split_seconds:
            segments = self.split_for_tiktok(
                full_video,
                parts_dir,
                "part",
                segment_seconds=segment_seconds,
                min_split_seconds=min_split_seconds,
            )
            if full_video.exists():
                full_video.unlink()
            output_video = Path(str(segments[0]["path"])) if segments else full_video
            master_video_path = None
        else:
            segments = [{
                "index": 1,
                "title": "Part 1",
                "path": str(full_video),
                "duration_seconds": int(duration) if duration else None,
            }]
            output_video = full_video
            master_video_path = str(full_video)

        return {
            "job_output_dir": str(job_dir),
            "output_video_path": str(output_video),
            "master_video_path": master_video_path,
            "playlist": {
                "title": title,
                "part_count": len(segments),
                "target": "tiktok",
            },
            "segments": segments,
            "subtitle_style": style,
            "render_duration_seconds": int(duration) if duration else None,
        }

    def render_hardsub(
        self,
        video_path: Path,
        srt_path: Path,
        output_path: Path,
        *,
        style: dict[str, Any] | None = None,
    ) -> str:
        ffmpeg = find_ffmpeg()
        if not ffmpeg:
            raise RuntimeError("FFmpeg is required but was not found in PATH.")

        style = normalize_subtitle_style(style)
        subtitles_filter = (
            f"subtitles={escape_filter_path(srt_path)}:"
            "force_style='"
            f"FontName=Arial,FontSize={style['font_size']},"
            f"Outline=3,MarginV={style['margin_v']},Alignment={style['alignment']}"
            "'"
        )
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(video_path),
            "-vf",
            subtitles_filter,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            str(output_path),
        ]
        process = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if process.returncode != 0:
            raise RuntimeError(process.stderr[-3000:])
        return str(output_path)

    def probe_duration(self, video_path: Path) -> float | None:
        ffmpeg = find_ffmpeg()
        if not ffmpeg:
            return None
        ffprobe = str(Path(ffmpeg).with_name("ffprobe"))
        if not Path(ffprobe).exists():
            ffprobe = shutil.which("ffprobe") or ""
        if not ffprobe:
            return self.probe_duration_with_ffmpeg(video_path, ffmpeg)
        cmd = [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ]
        process = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if process.returncode != 0:
            return self.probe_duration_with_ffmpeg(video_path, ffmpeg)
        try:
            return float(process.stdout.strip())
        except ValueError:
            return self.probe_duration_with_ffmpeg(video_path, ffmpeg)

    def probe_duration_with_ffmpeg(self, video_path: Path, ffmpeg: str) -> float | None:
        process = subprocess.run([ffmpeg, "-i", str(video_path)], capture_output=True, text=True, check=False)
        match = re.search(r"Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)", process.stderr)
        if not match:
            return None
        hours, minutes, seconds = match.groups()
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)

    def split_for_tiktok(
        self,
        video_path: Path,
        output_dir: Path,
        stem: str,
        *,
        segment_seconds: int = 150,
        min_split_seconds: int = 240,
    ) -> list[dict[str, object]]:
        duration = self.probe_duration(video_path)
        if duration is None or duration <= min_split_seconds:
            return [{
                "index": 1,
                "title": "Part 1",
                "path": str(video_path),
                "duration_seconds": int(duration) if duration else None,
            }]

        ffmpeg = find_ffmpeg()
        if not ffmpeg:
            raise RuntimeError("FFmpeg is required but was not found in PATH.")

        output_dir.mkdir(parents=True, exist_ok=True)
        effective_segment_seconds = choose_segment_seconds(duration, segment_seconds)
        pattern = output_dir / f"{stem}-%03d.mp4"
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(video_path),
            "-map",
            "0",
            "-c",
            "copy",
            "-f",
            "segment",
            "-segment_time",
            str(effective_segment_seconds),
            "-reset_timestamps",
            "1",
            str(pattern),
        ]
        process = subprocess.run(cmd, capture_output=True, text=True, check=False)
        parts = sorted(output_dir.glob(f"{stem}-*.mp4")) if process.returncode == 0 else []
        if process.returncode != 0 or len(parts) <= 1:
            clear_generated_parts(output_dir)
            self.split_with_forced_keyframes(video_path, output_dir, stem, segment_seconds=effective_segment_seconds)
            parts = sorted(output_dir.glob(f"{stem}-*.mp4"))
        if len(parts) <= 1 and duration > min_split_seconds:
            raise RuntimeError("Video split failed: FFmpeg did not create multiple TikTok parts.")
        return [
            {
                "index": index + 1,
                "title": f"Part {index + 1}",
                "path": str(path),
                "duration_seconds": int(self.probe_duration(path) or effective_segment_seconds),
            }
            for index, path in enumerate(parts)
        ]

    def split_with_forced_keyframes(
        self,
        video_path: Path,
        output_dir: Path,
        stem: str,
        *,
        segment_seconds: int,
    ) -> None:
        ffmpeg = find_ffmpeg()
        if not ffmpeg:
            raise RuntimeError("FFmpeg is required but was not found in PATH.")
        pattern = output_dir / f"{stem}-%03d.mp4"
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(video_path),
            "-map",
            "0",
            "-force_key_frames",
            f"expr:gte(t,n_forced*{segment_seconds})",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-f",
            "segment",
            "-segment_time",
            str(segment_seconds),
            "-reset_timestamps",
            "1",
            str(pattern),
        ]
        process = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if process.returncode != 0:
            raise RuntimeError(process.stderr[-3000:])

    def apply_publish_filter(
        self,
        input_path: Path,
        output_path: Path,
        *,
        preset: str = "studio_bright",
        speed: float = 1.05,
    ) -> str:
        ffmpeg = find_ffmpeg()
        if not ffmpeg:
            raise RuntimeError("FFmpeg is required but was not found in PATH.")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        vf = build_publish_video_filter(preset, speed)
        af = build_publish_audio_filter(speed)
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(input_path),
            "-vf",
            vf,
            "-af",
            af,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "22",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            str(output_path),
        ]
        process = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if process.returncode != 0:
            raise RuntimeError(process.stderr[-3000:])
        return str(output_path)


def find_ffmpeg() -> str | None:
    from_path = shutil.which("ffmpeg")
    if from_path:
        return from_path

    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def escape_filter_path(path: Path) -> str:
    value = str(path.resolve()).replace("\\", "/")
    value = value.replace(":", "\\:")
    value = value.replace("'", "\\'")
    return f"'{value}'"


def clear_generated_parts(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for path in output_dir.glob("part-*.mp4"):
        if path.is_file():
            path.unlink()


def normalize_subtitle_style(style: dict[str, Any] | None) -> dict[str, Any]:
    style = dict(style or {})
    font_size = int(style.get("font_size") or 16)
    font_size = max(12, min(34, font_size))
    position = str(style.get("position") or "bottom")
    if position not in {"bottom", "middle", "top"}:
        position = "bottom"
    preset = {
        "bottom": {"alignment": 2, "margin_v": 58},
        "middle": {"alignment": 5, "margin_v": 0},
        "top": {"alignment": 8, "margin_v": 72},
    }[position]
    return {"font_size": font_size, "position": position, **preset}


def build_publish_video_filter(preset: str, speed: float) -> str:
    color_filters = {
        "studio_bright": "eq=brightness=0.035:contrast=1.08:saturation=1.08:gamma=1.02,unsharp=5:5:0.45",
        "cinematic_dark": "eq=brightness=-0.035:contrast=1.14:saturation=0.94:gamma=0.98,unsharp=5:5:0.35",
        "warm_pop": "eq=brightness=0.02:contrast=1.1:saturation=1.16:gamma_r=1.04:gamma_b=0.97,unsharp=5:5:0.4",
        "cool_clean": "eq=brightness=0.015:contrast=1.06:saturation=1.02:gamma_b=1.04:gamma_r=0.98,unsharp=5:5:0.35",
        "natural": "eq=brightness=0:contrast=1.03:saturation=1.03,unsharp=5:5:0.25",
    }
    speed = max(0.9, min(1.15, speed))
    return f"setpts=PTS/{speed:.4f},{color_filters.get(preset, color_filters['studio_bright'])}"


def build_publish_audio_filter(speed: float) -> str:
    speed = max(0.9, min(1.15, speed))
    return f"atempo={speed:.4f},loudnorm=I=-16:LRA=11:TP=-1.5"


def choose_segment_seconds(duration: float, target_seconds: int) -> int:
    part_count = max(2, round(duration / target_seconds))
    return max(60, int((duration + part_count - 1) // part_count))
