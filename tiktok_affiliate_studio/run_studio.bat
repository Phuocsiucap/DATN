@echo off
chcp 65001 > nul
echo ============================================================
echo   Đang khởi động TikTok Affiliate AI Studio...
echo   Mở trình duyệt tại: http://127.0.0.1:8088
echo ============================================================
python "%~dp0run_studio.py"
pause
