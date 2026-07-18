# Gateway

Gateway giu API public cho dashboard:

- proxy `/api/auth`, `/api/admin/users`, `/api/social-profiles`, `/api/stats` sang `user_service`
- proxy `/api/bilibili-crawler` sang `bilibili_service`
- nhan event/websocket realtime cho dashboard
- dieu phoi crawl VNExpress qua Kafka

Entrypoint hien tai: `backend.gateway.app.main:app`.
