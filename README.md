# amz-deals

Trang tổng hợp deal Amazon Đức (`amazon.de`) phục vụ cộng đồng người Việt ở Đức & làm Amazon PartnerNet DE. https://deals.halle.biz.

## Nguồn dữ liệu & Tính năng

- **`lib/crawler.mjs`**:
  - **mydealz.de** (`/search/deals?merchant-id=3` + chuyên mục lỗi giá `/gruppe/preisfehler`).
  - **mein-deal.com** (WordPress REST API tag Amazon).
  - **monsterdealz.de** (WordPress REST API tag Amazon).
  - **dealdoktor.de** (WordPress REST API tìm deal Amazon, chỉ giữ bài trỏ sang `amazon.*`).
  - **de.camelcamelcamel.com** (RSS `top_drops/feed` lấy ASIN trực tiếp).
  - **Amazon PA-API 5.0** (`lib/paapi.mjs`, tuỳ chọn khi đã mở API): tự tìm deal theo từ khoá/brand (`SearchItems`) và làm giàu tiêu đề/ảnh/giá/tình trạng kho hàng loạt (`GetItems`, 10 ASIN/request).
  - **Keepa API** (tuỳ chọn trả phí): `/deal` cho `domainId=3` (Amazon.de).
- **`lib/db.ts`**: SQLite (`node:sqlite`), gồm các bảng `deals`, `price_history` ("Keepa mini" tự lưu lịch sử giá 90 ngày để phát hiện `⚡ Lỗi giá` & `📉 Đáy`), `crawl_runs`, `settings`. Trên VPS lưu tại volume `amz-deals_amz-deals-data` (`/app/data/deals.db`).
- **Tự động xoá deal cũ**: `pruneOldDeals()` chạy mỗi 30 phút (giữ `deals` theo `retentionDays`, mặc định 2 ngày; vẫn giữ `price_history` 90 ngày để so sánh giá).
- **Trang Admin (`/admin`)**: cấu hình nguồn crawl, Amazon PartnerNet Tag, PA-API 5.0, Keepa API, kiểm tra giá/hết hạn tức thì, lọc `⚡ Lỗi giá`, và nút **Copy bài** (tiêu đề + giá + mã giảm + link Aff) để đăng nhanh lên Facebook / Telegram.
- **Cloudflare WARP trên VPS (`oracle-a1`)**: container `amz-deals` tự bật `NODE_USE_ENV_PROXY=1` đi qua `http://warp:1080` để crawl tự động mỗi 30 phút (`CRAWL_INTERVAL_MIN=30`).
- **Tự động lấy deal từ máy Mac (tuỳ chọn/dự phòng)**:
  ```bash
  npm run auto:install   # cài macOS LaunchAgent chạy mỗi 30 phút (1800s)
  npm run auto:run       # chạy đẩy dữ liệu ngay lập tức
  npm run auto:logs      # xem log chạy tự động
  ```
  Script hỏi `/api/known` rồi POST `/api/ingest` (header `x-ingest-token`).

## Biến môi trường & Deploy

`./deploy.sh` (rsync → `oracle-a1:~/amz-deals`, `docker compose up -d --build`).
Các biến môi trường chính trong `~/amz-deals/.env` trên VPS:
- `ADMIN_PASSWORD`, `INGEST_TOKEN`
- `CRAWL_INTERVAL_MIN`, `CRAWL_PAGES`, `RETENTION_DAYS` (mặc định `2`)
- `AMAZON_TAG` (ví dụ `tenban-21`)
- Tuỳ chọn PA-API 5.0: `PAAPI_ACCESS_KEY`, `PAAPI_SECRET_KEY`, `PAAPI_KEYWORDS`, `PAAPI_MIN_SAVING_PCT`
- Tuỳ chọn Keepa API: `KEEPA_API_KEY`, `KEEPA_MIN_DROP_PCT`
Thông tin đăng nhập + token cho push ở `~/.config/amz-deals.env` trên Mac.
