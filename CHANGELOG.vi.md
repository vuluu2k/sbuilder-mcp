# Changelog

[English](./CHANGELOG.md) · **Tiếng Việt**

Mọi thay đổi đáng chú ý của dự án được ghi lại trong file này.
Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
và dự án tuân theo [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] - 2026-09-07

### Added
- sb_review giờ báo cáo store_gaps: các quy tắc sẵn sàng bán hàng của chính nền tảng — chưa có trang checkout đã publish, chưa có cổng thanh toán live, chưa có trang product đã publish, chưa có phương thức vận chuyển, không có gì mở lại giỏ hàng — không API nào lộ ra các quy tắc này và tất cả đều sống sót qua publish một cách âm thầm.
- sb_page_create nhận type, slug và is_homepage, để agent tạo được trang checkout và product mà /checkout và /products/{slug} phân giải theo type chứ không theo slug.
- sb_look nhận url để chụp một địa chỉ cho trước (thường là storefront đã publish) thay vì bản xem trước dạng draft, vốn không truyền dữ liệu cửa hàng và khiến mọi repeater render trạng thái rỗng.

### Changed
- sb_set giờ tính lại binding của một dataset element khi config.datasetSource hoặc config.kind thay đổi, thay vì để binding tiếp tục trỏ vào entity cũ.
- sb_add và sb_set giờ từ chối khi caller ghi specials.globalId, specials.appBlockId hoặc specials.appBlockHash — đây là các stamp do server ghi khi compose; tự ghi một trong số đó sẽ khiến lần lưu kế tiếp decompose node đó đè lên bản gốc chung.
- Số nguồn binding cho sb_bind và sb_review tăng từ 26 lên 77 nhờ đọc thêm context binding của editor, nên một binding do nền tảng tự seed như price không còn bị báo là dead.
- Tham số source của sb_bind không còn liệt kê toàn bộ nguồn binding trong schema; một nguồn không hợp lệ vẫn bị từ chối kèm danh sách đầy đủ.

### Fixed
- Các dataset element mới thêm (text-dataset, pricing-dataset, list-dataset, và các loại khác) giờ mang đúng binding mà editor sẽ gán lúc kéo-thả, thay vì lưu, publish và render mãi ở trạng thái placeholder.
- Xóa một node giờ cũng xóa các node vệ tinh của nó (list-empty, list-loading, các node quantity và product-variant-label), vốn chỉ gắn qua con trỏ parent và trước đây sống sót qua việc xóa rồi làm lần lưu kế tiếp bị từ chối vì id không xác định.
- sb_publish giờ gọi endpoint publish cấp site với pageIds, thay vì một route publish theo từng trang mà nền tảng trả về 404.
- Một kết quả tool được dựng từ response rỗng (như 204 khi xóa) không còn bị client từ chối do lỗi validate.
- sb_page_open, sb_set và sb_look không còn từ chối các node vệ tinh của một trang thật (list-empty, list-loading, các node quantity và product-variant-label) như thể chúng là orphan; kiểm tra khi lưu giờ xác minh sự gắn kết vào cây thay vì yêu cầu parent và child-list khớp chính xác.
- sb_media_upload giờ báo rõ rằng một cài đặt chỉ dùng API key không thể upload media, vì /api/media chỉ chấp nhận xác thực bằng session, thay vì trả về lỗi unauthorized trần trụi.

## [0.1.4] - 2026-09-07

### Added
- sb_set nhận một mảng edits[] để ghi nhiều node trong một lần gọi, thay vì lưu và publish riêng cho từng node.
- sb_api_call định dạng lại kết quả dạng danh sách bằng pick và max_items, và cắt bớt danh sách quá lớn để vừa giới hạn kết quả, kèm thông báo đã hiển thị bao nhiêu mục và cách thu hẹp lời gọi.
- Cả 25 tool đều mang chú thích MCP (readOnlyHint, destructiveHint, idempotentHint, openWorldHint), giúp các client tuân thủ chuẩn không còn hỏi xác nhận cho thao tác chỉ đọc.
- Bẫy thứ 5 giờ được chặn bằng code: một chỉnh sửa bên trong app block bị từ chối thay vì âm thầm mất khi lưu.
- Catalog được tạo lại từ nền tảng: 106 element, 412 API operation, và 26 nguồn binding.

### Changed
- sb_look giữ Chrome mở giữa các lần gọi, khởi chạy lười và tái sử dụng khi còn kết nối, đồng thời chụp nhiều chiều rộng song song thay vì lần lượt.
- Ảnh chụp của sb_look mặc định là JPEG (vẫn có thể chọn format: "png"), giúp giảm dung lượng ảnh và chi phí mà không đổi số token.
- Các box theo node_id của sb_look giờ tính độ sâu từ node được khung và chỉ bao phủ subtree của nó.
- sb_page_list, sb_templates và sb_media_list trả về tập trường được lọc sẵn nhỏ hơn, thay vì cả document hay cả khối settings.
- Các box đo layout của sb_look giờ trả về dạng tuple gọn ([id, type, x, y, w, h]) thay vì object in đẹp, với box_depth điều khiển độ sâu duyệt cây.
- Mô tả của các tool sb_bind, sb_look, sb_live_join, sb_review và sb_api_find được rút gọn; sb_bind không còn chèn cả 26 nguồn binding vào schema.
- Hướng dẫn bắt tay của server ngắn hơn, lấy số lượng tool/element/operation từ dữ liệu sinh tự động, và không còn nói sai rằng giá trị style ở base biến mất khi publish.
- Các finding từ sb_page_open, sb_review và sb_look dùng chung một mẫu fix cho mỗi loại lỗi, và các chỉ dẫn như FIX THESE chỉ được nói một lần cho mỗi tiến trình thay vì lặp lại ở mọi lần gọi.
- Mọi kết quả trả về của tool giờ là JSON rút gọn.

### Fixed
- sb_live_join báo rõ lý do một API key không thể tham gia phiên live, thay vì âm thầm tham gia vào một socket không bao giờ mở, vì nền tảng từ chối key dạng wbk_.
- Upload dạng multipart giờ trả về đúng lỗi kiểm tra theo từng trường của nền tảng thay vì một lỗi chung chung.
- Nhân bản một subtree chứa app block bị từ chối thay vì bị âm thầm rút gọn.
- fill() báo lỗi khi một code không có template thay vì trả về một fix rỗng.
- Bước publish của sb_api_call chia nhỏ batch ops để nằm dưới giới hạn khung 4 MiB của socket live, thay vì có nguy cơ làm rớt kết nối.
- Kết quả không phải danh sách không còn bị cắt âm thầm, và việc dùng max_items trên một kết quả không phải danh sách giờ được báo thay vì bị bỏ qua.
- Trường truncated do nền tảng trả về không còn bị logic định dạng kết quả ghi đè.
- Mỗi trang chụp ảnh giờ đóng trong khối finally riêng, nên một tab bị lỗi lần đầu không còn rò rỉ suốt vòng đời tiến trình.

## [0.1.2] - 2026-08-29

### Added
- Server báo cho nền tảng biết nó đang chạy trên máy nào và trong client nào, để app Agent của cửa hàng hiển thị được mọi agent đang kết nối.
- sb_look đo kết quả render: nội dung tràn khỏi viewport, các phần tử anh em chồng lên nhau, và chữ quá nhỏ để đọc được báo cáo kèm chiều rộng mà lỗi xảy ra.

## [0.1.1] - 2026-08-28

Sửa lỗi, thêm tool, và vòng lặp nhìn.

## [0.1.0]

Bản phát hành đầu tiên.
