# amz-deals

Deal Amazon lấy từ **mydealz.de** (`/search/deals?merchant-id=3`) và **mein-deal.com** (WordPress REST API tag `Amazon`), dùng riêng. https://deals.halle.biz (basic auth).

- `lib/crawler.mjs`: lấy danh sách deal Amazon từ mydealz.de (`data-vue3`) và mein-deal.com (`wp-json/wp/v2/posts?tags=43684`), phân giải ASIN qua redirect outbound, lấy tên + ảnh từ `amazon.de/dp/<ASIN>`. Bỏ qua các deal cũ hơn `retentionDays` (mặc định 2 ngày).
- `lib/db.ts`: SQLite (`node:sqlite`), bảng `deals`, `crawl_runs`, `settings`. Trên VPS ở volume `amz-deals_amz-deals-data` (`/app/data/deals.db`).
- **Tự động xoá dữ liệu cũ sau 2 ngày**: server tự động chạy `pruneOldDeals()` mỗi 30 phút (và sau mỗi lần `ingest`/`crawl`), có thể chỉnh số ngày giữ dữ liệu tại trang `/admin`.
- **Trang Admin (`/admin`)**: xem thống kê, cấu hình số ngày giữ dữ liệu / số trang crawl / lịch crawl server / Amazon tag, chạy thao tác dọn dữ liệu nhanh, quản lý từng deal (ẩn/hiện/xoá/reset ASIN) và xem lịch sử chạy.
- **Cloudflare WARP trên VPS (`oracle-a1`)**: chạy container `caomingjun/warp` tại `~/warp/docker-compose.yml` trên network `coolify` (`http://warp:1080` và `127.0.0.1:1080`). Container `amz-deals` tự bật `NODE_USE_ENV_PROXY=1` đi qua `http://warp:1080` để crawl tự động mỗi 2 tiếng (`CRAWL_INTERVAL_MIN=120`) mà không bị IP Oracle 403.
- **Tự động lấy deal từ máy Mac (tuỳ chọn/dự phòng)**:
  ```bash
  npm run auto:install   # cài macOS LaunchAgent chạy mỗi 2 giờ (7200s)
  npm run auto:run       # chạy đẩy dữ liệu ngay lập tức
  npm run auto:logs      # xem log chạy tự động
  ```
  Script hỏi `/api/known` (lấy danh sách deal đã biết + `retentionDays` + `crawlPages` từ server), rồi POST `/api/ingest` (header `x-ingest-token`).

## Deploy
`./deploy.sh` (rsync → `oracle-a1:~/amz-deals`, `docker compose up -d --build`). Bí mật ở `~/amz-deals/.env` trên VPS: `BASIC_AUTH_USERS` (htpasswd apr1, để trong nháy đơn), `INGEST_TOKEN`, `CRAWL_INTERVAL_MIN`, `CRAWL_PAGES`, `RETENTION_DAYS` (mặc định `2`), `AMAZON_TAG` (tag affiliate, tuỳ chọn).
Thông tin đăng nhập + token cho push ở `~/.config/amz-deals.env` trên Mac.
