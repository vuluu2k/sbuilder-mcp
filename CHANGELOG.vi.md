# Changelog

[English](./CHANGELOG.md) · **Tiếng Việt**

Mọi thay đổi đáng chú ý của dự án được ghi lại trong file này.
Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
và dự án tuân theo [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
