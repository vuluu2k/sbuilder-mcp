# Changelog

[English](./CHANGELOG.md) · **Tiếng Việt**

Mọi thay đổi đáng chú ý của dự án được ghi lại trong file này.
Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
và dự án tuân theo [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-09-07

### Fixed
- sb_live_join giờ chấp nhận API key (SB_TOKEN) để vào phòng live-edit, thay vì từ chối và bắt buộc dùng session; nền tảng giờ kiểm soát socket dựa trên quyền member được ủy quyền qua key và site của chính key đó, nên một cài đặt chỉ dùng key có thể tham gia như mọi tool khác.
- sb_media_upload giờ chấp nhận API key, thay vì từ chối và bắt buộc dùng session; endpoint upload của nền tảng giờ nằm sau cùng một cổng chặn với sb_sites, và lỗi 401 khi có key giờ báo rằng key thiếu quyền media hoặc thuộc site khác, thay vì bảo caller đổi sang loại credential khác.

## [0.2.1] - 2026-09-07

### Added
- sb_add và sb_move giờ seed đúng nội dung mà editor gán cho một element lúc kéo-thả: các node vệ tinh như skin của từng mục accordion hay nút dùng chung của tab, và các subtree được seed sẵn cho trạng thái rỗng của list cũng như cho dropdown, select và popover — vốn render thành hộp trống nếu thiếu chúng.
- sb_page_open giờ báo cáo compose_warnings từ nền tảng, bao gồm globalMissing — nghĩa là server không tìm thấy bản gốc của một shared section và đã xóa node tham chiếu khỏi document trả về; lưu từ đây sẽ khiến việc mất đó thành vĩnh viễn.
- sb_page_create giờ báo cáo slug_renamed khi slug yêu cầu đã bị chiếm; nền tảng âm thầm lưu một slug có hậu tố khác và trả về thành công, nên mọi link được gán theo slug yêu cầu ban đầu sẽ chết nếu không có cảnh báo này.
- sb_publish giờ báo cáo not_published khi một trang chưa có draft đã lưu, vì nền tảng bỏ qua trang đó và vẫn trả về thành công kèm những trang khác đã publish được.
- sb_review giờ báo cáo unlinked_form khi một form element không trỏ tới form nào, vì nó không compose được gì và publish thành một hộp trống mà nền tảng không hề cảnh báo.
- sb_review giờ báo cáo dead_menu_link khi một menu không có entry nào hoặc một entry không có href, vì renderer chỉ đọc specials.menuItems chứ không đọc menuId.
- sb_review giờ báo cáo extra_repeater_child khi một repeater element (như list-dataset) có nhiều hơn một child, vì chỉ child đầu tiên được render cho mỗi record.

### Changed
- sb_add và sb_move giờ từ chối thêm hoặc di chuyển child thứ hai vào một repeater element, vì chỉ child đầu tiên được render; việc sắp xếp lại thứ tự trong cùng một parent vẫn được cho phép.
- sb_duplicate giờ cũng từ chối nhân bản vào một repeater element vì lý do tương tự, và deep-copy các node vệ tinh (như skin của accordion) kèm việc ghi lại con trỏ về đúng owner mới, thay vì để bản sao trỏ vào vệ tinh của bản gốc.
- sb_duplicate giờ loại bỏ các stamp composition (globalId, globalRef, globalKind, globalRev) khỏi node được nhân bản thay vì sao chép nguyên trạng, vì hai node dùng chung một stamp sẽ bị nền tảng từ chối ở lần lưu kế tiếp.
- sb_publish giờ chỉ trả về các trường mà caller thực sự dùng đến (pageId, slug, isHomepage) cho mỗi trang đã publish, thay vì toàn bộ document, html và css đã render của mọi trang mà cascade chạm tới.
- Bản xem trước dry_run và phản hồi thật của sb_page_create giờ redact settings giống cách sb_api_call làm, vì đây là một object tự do mà caller có thể lỡ truyền credential vào.
- Lượt duyệt cây nội bộ dùng bởi sb_remove, sb_duplicate và kiểm tra khi lưu giờ đi theo cả các node vệ tinh (gắn qua config, không qua child list) bên cạnh child list, nên việc xóa hoặc nhân bản một node giờ xử lý đúng cả các vệ tinh của nó.
- Kiểm tra khi lưu giờ từ chối một document có stamp composition (globalId, overlayId) nằm trên node không phải con trực tiếp của ROOT, hoặc bị lặp trên hai node, vì nền tảng cũng từ chối cả hai trường hợp này nhưng báo lỗi mơ hồ ở bước sau.

### Fixed
- Sắp xếp lại một node trong cùng parent của repeater không còn bị chặn nhầm bởi guard child thứ hai mới thêm.

## [0.2.0] - 2026-09-07

### Added
- sb_review giờ báo cáo static_in_dataset khi một element bên trong repeater (như một image thường trong thẻ sản phẩm) chỉ có thể render một giá trị đã gán cho mọi record, đồng thời chỉ ra element có thể hiển thị record để thay thế.
- sb_review giờ báo cáo unbound_dataset_element khi một dataset element có khả năng hiển thị record nhưng không mang binding nào, thay vì âm thầm render cùng một nội dung đã gán cho mọi dòng.
- sb_page_open giờ báo cáo blank_page_repair khi document lưu trữ của trang đặt tên root là rootId thay vì root_node_id — alias khiến trang render rỗng.

### Fixed
- Mở một trang có document đặt tên root là rootId không còn bị từ chối như document hỏng; document giờ tự nhận alias này để lần lưu kế tiếp ghi đúng khóa chuẩn và trang không còn render rỗng.

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
