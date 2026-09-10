# Changelog

[English](./CHANGELOG.md) · **Tiếng Việt**

Mọi thay đổi đáng chú ý của dự án được ghi lại trong file này.
Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
và dự án tuân theo [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0] - 2026-09-10

### Added
- sb_set giờ ghi một config key mà renderer `html.go` của trang chỉ đọc ở base (13 key, gồm cả trục dữ liệu của repeater `datasetSource`, `kind`, `collectionId`, `collectionType`) xuống base thay vì breakpoint hiện tại, và báo cáo việc chuyển này là `base_only`, vì trước đây ghi theo breakpoint lên một trong các key này chỉ cập nhật canvas của editor rồi âm thầm biến mất khi publish.
- sb_traits_for giờ trả về `config_values` cho các config key mà renderer của nền tảng coi một giá trị không nhận diện được là một cách viết khác (alias) thay vì báo lỗi, liệt kê các giá trị hợp lệ và alias của chúng (`category` là một cách viết khác của `collection`, chẳng hạn), vì trước đây một repeater đặt giá trị nghe hợp lý như "bestseller" sẽ publish và render toàn bộ catalogue dưới một tiêu đề sai mà không báo lỗi ở đâu cả.
- sb_set giờ cảnh báo một lần cho mỗi cặp config key/giá trị khi một lần ghi đặt một trong các giá trị config này thành thứ mà renderer không nhận diện được.
- sb_node_read giờ trả về một khối `preset` nêu tên theme preset mà một node dùng để vẽ, các giá trị màu và thuộc tính khác của nó với mọi chuỗi var() đã được làm phẳng, cùng những key mà node đã override, khép lại khoảng trống ở chín loại element (gồm icon, button, heading, text, image) mà giao diện mặc định của chúng giờ nằm trong một theme preset của site chứ không phải trong style riêng của node, và trước đây đọc lại không thấy màu nào trên một trang rõ ràng đang tô màu đó.
- sb_set giờ cảnh báo một lần cho mỗi theme preset khi một lần ghi style thuần sắp làm một node tách khỏi preset đó vĩnh viễn, vì giá trị riêng của node từ đó sẽ luôn thắng preset ở mọi lần đổi bảng màu sau này.
- sb_add giờ trả về một ghi chú `inert` khi một subtree chứa locale-switcher (vẽ ra một chip ngôn ngữ giả và không chuyển đổi gì cả khi site có dưới hai locale được cấu hình) hoặc breadcrumb (nhãn "Home" ở gốc có thể chỉnh sửa và mặc định là tiếng Anh), vì cả hai element đều hiển thị thuyết phục trong khi không được nối với gì cả, theo cách mà cả sb_review lẫn sb_look đều không thể phát hiện sau khi đã thêm.
- sb_page_create giờ gieo sẵn nội dung cho một loại trang store (product, category, search, blog, post, complete) bằng đúng document mà editor của nền tảng đưa cho merchant — một trang product sẽ có sẵn cả buy box, bao gồm cả binding `add_to_cart` — thay vì một trang trống; truyền `seed:false` để có trang trống, và `locale`/`headline` để chọn câu cảm ơn của trang hoàn tất đơn hàng.
- npm run codegen và npm run codegen:check giờ cảnh báo (không làm fail) khi một route được annotate trong code server của nền tảng nhưng lại vắng mặt trong swagger.json, nêu tên các route còn thiếu, vì khoảng trống này không thể khắc phục bằng cách regenerate bất cứ thứ gì trong repo này.

### Fixed
- Catalog element và operation được làm mới theo đúng bản `8e40bbab` của nền tảng: năm relation-slot operation (tạo/sửa/xoá kệ hàng tuyển chọn và cả hai endpoint picks) trước đây có thể gọi được nhưng dùng chung một annotation với endpoint danh sách, giờ được ghi tài liệu riêng; và toàn bộ bề mặt cấu hình của trợ lý chat AI (`GET /api/chat-providers`, `GET/PUT/DELETE /api/sites/{siteId}/chat-settings`) lần đầu tiên được ghi tài liệu; catalog giờ bao phủ 495 operation, 166 trong số 216 write operation có shape body request.

### Internal
- Catalog được sinh ra giờ có thêm bảng seed trang store (`storepages.generated.ts`) và bảng theme preset (`theme.generated.ts`), cả hai được tạo ra bằng cách gọi trực tiếp các hàm dựng seed và theme preset của chính nền tảng thay vì sao chép kết quả của chúng, để lần platform thay đổi tiếp theo ở một trong hai chỗ đó tự động được phản ánh vào lần codegen kế tiếp của server này.

## [0.14.1] - 2026-09-09

### Added
- Catalog element được làm mới lên 111 element, thêm `rating-stars` (vẽ điểm số dạng năm ngôi sao bằng icon) và `chat-widget` (một trợ lý AI mà merchant tự cấu hình bằng key của họ), cả hai đều dùng được ngay qua sb_catalog_search, sb_traits_for và sb_add mà không cần thêm code nào ở đây.

### Fixed
- npm run codegen:check giờ cũng từ chối một checkout web_builder mà HEAD của nó không nằm trong bất kỳ remote branch nào, vì một worktree tách rời trỏ tới một commit local chưa từng push trước đây đã vượt qua mọi kiểm tra trước đó và tạo ra một catalog mô tả một element mà không deployment nào thực sự có; một repo không có remote nào thì không báo gì thay vì từ chối, vì không có gì để đo containment.

## [0.14.0] - 2026-09-09

### Added
- sb_review giờ báo cáo `categoryScope` khi một store có nhiều hơn một product category mà không category nào được link tới một page riêng, vì khi đó `/collections/{slug}` sẽ rơi về default template của loại category cho mọi category, và không có gì trên template dùng chung đó thu hẹp product feed theo category trong URL, nên khách hàng sẽ thấy toàn bộ catalogue (hoặc sản phẩm của category khác) dù mở category nào; finding nêu rõ cách khắc phục — mỗi category một page riêng với repeater đặt `{ "collectionType": "collection", "collectionId": "<id category>" }`, liên kết bằng `sb_api_call post:/api/sites/{siteId}/page-links/bulk`.

## [0.13.1] - 2026-09-09

### Fixed
- Việc dựng checkout của sb_store giờ tự gieo một event `form:success` đưa khách hàng tới `/checkout/complete`, vì `settings.afterSubmit.action = "redirect"` của chính form record được API lưu lại nhưng nền tảng không mang nó đi đâu cả, khiến một đơn hàng đã hoàn tất vẫn ở lại trang checkout với mọi tổng giỏ hàng hiện 0.
- sb_review giờ báo cáo `order_goes_nowhere` cho một trang có dáng checkout (có form và có cart total) mà form của nó không có event `form:success` nào điều hướng đi, nêu rõ lệnh sb_event để khắc phục.

## [0.13.0] - 2026-09-09

### Added
- sb_set giờ hỗ trợ `specials.hoverHostDepth` khi ghi `state:"parentHover"`, cho phép một rule hover-cha hangs off bất kỳ ancestor box nào (đánh số từ 1, gần nhất trước) thay vì luôn luôn là parent trực tiếp của node, và trả về box mà nó thực sự hangs off, các ancestor rộng hơn đang có sẵn, cùng thông báo khi một depth vượt quá độ dài chuỗi bị clamp về box ngoài cùng.
- Catalog element được làm mới lên 109 element, thêm `cart-count` và tùy chọn `hoverSwapImage` trên `product-image-feature` (hiện ảnh gallery kế tiếp khi trỏ chuột vào, mặc định tắt).

## [0.12.0] - 2026-09-09

### Added
- npm run codegen:check giờ cũng từ chối một checkout mà HEAD của nó mang các commit chạm vào những thư mục mà nó đọc (schema/src, editor/src, server/render, server/docs) mà nhánh upstream không có, nêu tên các commit đó; việc chỉ kiểm tra thay đổi chưa commit từng bị qua mặt một lần, bởi một tính năng đã được commit ở local nhưng chưa từng push, khiến working tree trông sạch trong khi catalog mà nó tạo ra lại đi trước mọi nền tảng đã triển khai. Một worktree tách rời checkout tại origin/main không có upstream nên được miễn kiểm tra này, đúng như cách mà chính kiểm tra này khuyến nghị; `--dirty` vẫn cho phép ghi đè.

### Fixed
- Catalog request-shape được sinh ra giờ bao phủ thêm ba write operation mà trình phân tích handler trước đây bỏ sót hoặc gán sai: `roles/{roleId}` (một case arm liệt kê nhiều phương thức HTTP cùng lúc), `products/{productId}/categories` (một dispatcher định tuyến theo một đoạn path cố định thay vì theo method), và `sites/{siteId}/org` (một khối doc comment dùng chung cho hai handler liền kề được khai báo theo thứ tự ngược lại, giờ được gán theo đúng tên mà nó mở đầu). 162 trong số 276 write operation giờ đã có shape, tăng từ 157, nhờ đó sb_api_call và sb_undo có thể thao tác trên cả ba mà không cần đoán body.

## [0.11.3] - 2026-09-09

### Fixed
- sb_set giờ chỉ nói ghi chú định tuyến hover một lần cho mỗi loại element trong mỗi tiến trình thay vì một lần cho mỗi node, vì việc sửa mọi nút button trên một trang trong cùng một batch trước đây trả về mười bản sao của cùng một đoạn văn 300 ký tự; một loại element khác vẫn nhận được ghi chú riêng của nó, vì nó nói một điều khác.

## [0.11.2] - 2026-09-09

### Fixed
- Khi sb_set định tuyến một lần ghi hover tới nơi lưu cũ của element (ví dụ `button`), giờ nó cũng xoá luôn mọi giá trị còn sót trong slot `states.hover` không ai đọc, ngay trong cùng một lệnh — thay vì để lại chúng cho sb_review tiếp tục báo là `hover_dead`; thông báo của chính finding này trước đây nêu `unset` là cách xoá, nhưng `unset` cũng không thể chạm tới nơi lưu cũ đó, khiến cách sửa được ghi ra là không thể thực hiện được.

## [0.11.1] - 2026-09-09

### Added
- sb_review giờ báo cáo `hover_dead` cho một node mà element của nó lưu hover state ở nơi cũ mà chính renderer của nó đọc, thay vì slot `states.hover` phổ quát — ví dụ như `button` — và nêu rõ lệnh sb_set để chuyển giá trị tới đúng nơi sẽ thực sự hiển thị.
- npm run codegen giờ từ chối chạy trên một checkout web_builder có thay đổi chưa commit trong các thư mục mà nó đọc (schema/src, editor/src, server/render, server/docs), nêu tên các file bẩn thay vì âm thầm đưa công việc dở dang của một phiên làm việc đồng thời vào catalog đã commit; `--dirty` cho phép ghi đè khi bạn tự tạo ra thay đổi đang dở dang đó.

### Fixed
- Catalog element được sinh lại từ một ref đã commit, loại bỏ một element `cart-count` và chủ sở hữu satellite của nó vốn đã lọt vào từ thay đổi nền tảng chưa commit của một phiên làm việc khác; catalog trở lại 108 element.

## [0.11.0] - 2026-09-09

### Added
- `state:"hover"` của sb_set giờ định tuyến mỗi lần ghi tới đúng nơi mà renderer của element đó thực sự đọc, vì bộ biên dịch hover phổ quát của nền tảng chủ động đứng ngoài đối với mười hai loại element tự khai báo biến thể Hover riêng; một lần ghi trên `button` giờ vào `config.stateHover` (dạng phẳng, chỉ ở base) thay vì slot `states.hover` không ai đọc, và kết quả trả về cho biết giá trị đã đi vào đâu để người gọi đọc lại node không bị bất ngờ.
- sb_set từ chối ghi `state:"parentHover"` trên một node không có "hộp" nào để dựa vào — một satellite, một con trực tiếp của root trang, hoặc một node mồ côi — nêu rõ lý do thay vì lưu một rule mà nền tảng sẽ không bao giờ khớp.
- sb_set từ chối `config.revealOnHover` trên một node không có hộp như vậy vì cùng lý do, vì nền tảng sẽ không phát ra cả hai nửa của hiệu ứng reveal nếu thiếu nó, khiến phần tử đơn giản là luôn hiển thị.
- sb_set giờ dịch `hidden: true` dưới một hover state thành `display: none`, và từ chối mọi config key khác hoặc giá trị `false`, khớp với đúng quy tắc đã áp dụng cho trạng thái `stuck`.
- sb_set cảnh báo khi một lần ghi nhắm vào hover state của `product-image-list`: meta của nó hứa hẹn `states.hover`, nhưng đo được vào ngày 2026-09-09 thì chưa có gì trong nền tảng biên dịch nó cả, nên override vẫn được lưu đúng chỗ meta quy định và sẽ bắt đầu hiển thị khi nền tảng khắc phục xong khoảng trống này.

## [0.10.0] - 2026-09-09

### Added
- sb_set giờ nhận `unset`, một mảng tên key cần xoá khỏi đúng slot mà một lần ghi sẽ nhắm tới — base, một breakpoint, hoặc một trong hai nơi lưu của một state — nhờ đó mọi finding nêu "xoá override đi" làm cách sửa giờ có công cụ để thực sự làm điều đó. `keys` giờ có thể bỏ qua khi `unset` đã làm phần việc, và một lần xoá thuần tuý được miễn khỏi kiểm tra sticky-host để nó có thể sửa một finding `stuck_no_host` thay vì bị chính kiểm tra đó từ chối.

### Fixed
- Kiểm tra `stuck_no_host` của sb_review giờ đếm số key bên trong slot trạng thái stuck thay vì chỉ kiểm tra slot có tồn tại hay không, khớp với `HasStuckOverrides` của chính nền tảng; một slot rỗng (trạng thái mà một lần sửa bằng `unset` để lại) không còn tiếp tục báo cáo finding mà nó vừa được dùng để khắc phục.

## [0.9.2] - 2026-09-09

### Added
- sb_look giờ báo cáo `stuck_note` một lần mỗi tiến trình khi trang có ghim một phần tử (`position: sticky` hoặc `fixed`), giải thích rằng một ảnh chụp màn hình không thể cho biết phần tử đó có thực sự bị "stuck" hay không, và chỉ ra một trình duyệt server (Playwright MCP hoặc Chrome DevTools MCP) để cuộn trang và kiểm tra class `wb-stuck`.

### Internal
- docs/tools.md và skill sbuilder-site-design giờ ghi lại server MCP nào (Figma, Google Stitch, Chrome DevTools, Playwright) trả lời câu hỏi nào, bên cạnh sb_look, bao quát sáu trường hợp mà chỉ riêng ảnh chụp màn hình không thể trả lời: một header sticky có thực sự ghim hay không, một style "không được áp dụng", nút bấm mở giỏ hàng, việc submit checkout, xem trước một template entity với dữ liệu thật, và độ ổn định bố cục (CLS).

## [0.9.1] - 2026-09-09

### Fixed
- sb_set giờ từ chối ghi `config.stuckAfter` nếu giá trị sẽ bị renderer âm thầm bỏ qua — số âm, không hữu hạn, rỗng, hoặc được đặt trên một node không thể ghim — thay vì lưu, save rồi publish một ngưỡng mà runtime island không bao giờ đọc và lặng lẽ quay về đáp án tự động của nó.

## [0.9.0] - 2026-09-08

### Added
- Tham số `state` của sb_set giờ nhận `"stuck"`, trạng thái mà một phần tử được ghim (`position: sticky` hoặc `fixed`) mang khi runtime island của nền tảng đánh dấu nó là stuck; sb_set sẽ từ chối ghi khi không có node nào — bản thân node hay bất kỳ tổ tiên nào — có thể ghim được, vì khi đó renderer sẽ không biên dịch rule nào cả và override sẽ bị lưu, publish rồi không bao giờ được vẽ ra.
- sb_set giờ tự gieo `top`/`zIndex` khi ghi `position: sticky`, khớp với những gì editor của chính nền tảng gieo sẵn, vì một header được ghim mà không có z-index sẽ bị nội dung phía sau vẽ đè lên ngay khi cuộn qua.
- sb_set giờ cảnh báo (cả ở dry_run lẫn lần ghi thật) khi một node sticky nằm trong một tổ tiên có overflow cắt nó, vì sticky phân giải theo tổ tiên có thể cuộn gần nhất, và một tổ tiên cắt nội dung sẽ âm thầm vô hiệu hóa việc ghim.
- sb_review giờ báo cáo `stuck_no_host` cho một override trạng thái `stuck` mà không có node ghim nào ở chính nó hay tổ tiên, và `sticky_blocked` cho một node sticky bị tổ tiên có overflow vô hiệu hóa, để một document đi đến một trong hai trạng thái này qua import, template, hoặc một chỉnh sửa sau đó vẫn bị phát hiện dù đã bỏ qua được các kiểm tra lúc ghi của sb_set.
- sb_import giờ mang theo thuộc tính ghim `sticky`/`fixed` của một section nguồn sang node được import, kèm theo đúng các giá trị gieo về offset và thứ tự layer mà sb_set ghi, vì một section được ghim để luôn hiển thị là một quyết định bố cục khác với một section cuộn trôi đi.

### Fixed
- sb_media_upload từ `url` không còn thất bại với mọi loại ảnh và video; trước đây lần upload được gửi đi mà không khai báo content type, khiến nền tảng coi đó không phải ảnh cũng không phải video, nên nó từ chối cả một file PNG bình thường với thông báo nêu sai nguyên nhân. Giờ đây content-type khai báo của nguồn được dùng khi nó xác định đúng loại file, và phần mở rộng của tên file được dùng khi không xác định được.
- sb_import không còn làm mất chữ của một liên kết khi liên kết đó bọc markup (như `<a><span>Docs</span></a>`) mà nội dung bên trong không import được gì; giờ nó giữ lại chính chữ của liên kết thay vì import ra không có gì cho nó.

### Internal
- Catalog element được tạo lại dựa trên một bản checkout hiện tại của nền tảng: `dataset-block` và `list-dataset` giờ mang một content tip cảnh báo rằng một node dataset bên trong repeater phải bind theo đúng `config.datasetSource` của chính nó, chứ không phải theo mặc định của element.

## [0.8.0] - 2026-09-08

### Added
- Tham số `spec` của sb_add giờ nhận `responsive` trên bất kỳ node nào, cho phép gieo các override style và config theo từng breakpoint ngay lúc tạo node, thay vì phải gọi thêm sb_set cho mỗi giá trị responsive; nó merge đè lên các giá trị responsive mặc định mà chính element đã gieo sẵn theo từng namespace, nên việc gieo một style cho mobile sẽ không làm mất config mobile riêng của element.
- sb_import nhận max_nodes (mặc định 300), một giới hạn duy nhất cho toàn bộ lần import; nó thay thế giới hạn theo từng section cũ, vốn âm thầm trở thành giới hạn thực tế trên một trang mà `<body>` chỉ có một phần tử con cấp cao nhất, và số lượng bị bỏ qua giờ được báo cáo cả ở lần chạy thật, không chỉ ở dry run.
- sb_import giờ giữ lại cách bố trí của trang nguồn: một container thực sự sắp xếp các phần tử con bằng flex hoặc grid sẽ trở thành một row thật, tự động xếp chồng ở mobile, thay vì mọi section đều bị làm phẳng thành một cột dọc.

### Fixed
- sb_import giờ lấy text từ bất kỳ phần tử nào chứa nó, không chỉ `<p>` và `<blockquote>`, vì phần lớn nội dung trên web không dùng thẻ paragraph; một trang dùng layout bảng hoặc trang dùng utility-CSS trước đây bị import mà không lấy được chữ nào.
- Cơ chế fallback khi không có kết quả của sb_import giờ thử lại với `<main>` của trang bất cứ khi nào các section tìm được không tạo ra nội dung nào, thay vì chỉ thử lại khi không tìm được section ứng viên nào ngay từ đầu.
- sb_import giờ giữ lại một liên kết nội dung không được "tô" thay vì bỏ nó đi, lấy nó thành một button kiểu link phẳng thay vì chỉ lấy những liên kết đã trông giống một call-to-action; một button được "tô" vẫn cần có màu nền hoặc viền có độ dày thật, nên các viền reset độ dày bằng 0 của một trang dùng Tailwind không còn bị nhầm là một call-to-action nữa.
- sb_import không còn import header và footer cấp trang của trang nguồn, vì trang đích đã có sẵn header/footer riêng dưới dạng global dùng chung; một `<header>` nằm lồng bên trong một section (dạng hero) vẫn được giữ lại.

## [0.7.2] - 2026-09-08

### Fixed
- sb_import không còn xếp một liên kết block-level ngắn vào loại button; trước đây rule chỉ dừng ở "không phải inline", nên danh sách liên kết điều hướng trong sidebar tài liệu bị trả về thành hàng chục button. Giờ một call-to-action thật phải được "tô" bằng màu nền hoặc viền, và viền chỉ được tính khi có độ dày, vì một trang dựng bằng Tailwind đặt `border-style: solid; border-width: 0` trên mọi phần tử.
- Bước capture trang của sb_import không còn chờ cố định 600ms trước khi đọc trang; giờ nó dùng lại chính cơ chế chờ ổn định (settle) của sb_look, chờ đến khi trang thực sự ngừng thay đổi thay vì một khoảng chờ cố định vừa quá dài với trang tĩnh vừa quá ngắn với trang tự dựng bằng script.

## [0.7.1] - 2026-09-08

### Added
- sb_import nhận max_images (mặc định 24), giới hạn số ảnh nó tải lên từ trang được import, vì mỗi ảnh là một lần upload thật và một dạng trang như tường tài trợ có thể chứa hàng chục ảnh trong một lần gọi tool.

### Fixed
- sb_import không còn nhân đôi nội dung nằm trong một section lồng nhau; trước đây nó khớp với mọi `<section>` trên trang, nên một band bên ngoài và các band lồng bên trong nó đều bị lấy, khiến nội dung bên trong xuất hiện hai lần. Giờ chỉ section trong cùng khớp được giữ lại, vì section ngoài cùng cũng là một ứng viên và giữ nó sẽ làm cả trang chỉ còn một band.

## [0.7.0] - 2026-09-08

### Added
- sb_import đọc bất kỳ URL công khai nào và thêm cấu trúc, nội dung của nó vào trang đang mở dưới dạng các element thật — section, heading, text, image, button, list — được khoác token của chính trang đó (màu và độ đậm lấy từ heading đầu tiên, màu và cỡ chữ lấy từ dòng văn bản đầu tiên, màu nền và bo góc lấy từ nút không trong suốt đầu tiên) thay vì nhúng nguyên markup của nguồn. Một ảnh được giới hạn kích thước ở cả hai chiều thay vì chỉ giới hạn chiều rộng, vì một SVG không có kích thước pixel nội tại nên nếu không sẽ kéo dài cả một section thành hàng nghìn pixel khoảng trắng; mỗi ảnh được tải lên thư viện media của chính site, giữ nguyên URL gốc nếu upload thất bại, và một lỗi upload được báo cáo theo nhóm và đếm theo lý do thay vì chỉ là một con số trần trụi. dry_run (mặc định) trả về những gì tìm thấy trước khi thêm bất cứ thứ gì.
- npm run codegen:check chạy trình sinh catalog dựa trên một ref đã commit của nền tảng và không ghi gì cả, thoát với mã 1 và nêu tên mọi file sẽ thay đổi, để một catalog cũ được phát hiện trước khi một tool bắt đầu mô tả một element hay operation mà nền tảng không còn nữa.

### Changed
- Catalog element và API được tạo lại: thêm element bundle-items cùng các trường kind, bundlePricing, bundleValue và bundleItems trên một sản phẩm, cùng một loạt operation cho relation-slot và lệnh làm phẳng chuỗi storefront; trần token budget của sb_api_find được nâng lên 3.500 để chứa call sheet sản phẩm lớn hơn.

### Fixed
- sb_look giờ có thể chụp được một node có box nằm dưới khoảng 900px đầu tiên của trang; trước đây một yêu cầu clip chỉ chạy trên viewport và thất bại với lỗi "Clipped area is either empty or outside the resulting image" của Playwright với bất kỳ node nào nằm xa hơn, và giờ nó chụp toàn trang trước để tọa độ clip khớp bất kể node nằm ở đâu.

## [0.6.0] - 2026-09-08

### Added
- sb_store giờ nhận action:"form" bên cạnh action:"checkout", gieo bất kỳ template nào trong 17 template form của nền tảng (contact, subscribe, order, address, consult, booking, stay, feedback, event, quote, apply, và năm form xác thực login, register, forgot, verify, reset) cùng field document riêng của nó, thay vì trước đây server này chỉ dựng được đúng order form của checkout; nó tạo form, PUT lại nguyên vẹn (nếu không thì một lần tạo đơn thuần sẽ bị âm thầm đổi tên và chuyển thành custom), rồi lưu field document của template, và xoá lại form nếu một trong hai lệnh ghi đó thất bại. Nó không tạo trang, vì đặt form login ở đâu là quyết định thiết kế — hãy đặt form bằng sb_add rồi trỏ specials.formId vào id được trả về.

### Fixed
- sb_review không còn báo cáo empty_container trên node tham chiếu của một global section hay app block, vì một trang lưu header hoặc footer dùng chung dưới dạng node rỗng gắn cờ globalRef hoặc appBlockRef mà nền tảng sẽ ghép bản gốc vào khi đọc; cách sửa mà finding này từng nêu ra — thêm gì đó vào bên trong — sẽ bị lần lưu kế tiếp phân rã mất ngay.

## [0.5.0] - 2026-09-08

### Added
- sb_review giờ báo cáo default_seed_copy khi một node vệ tinh ở trạng thái rỗng vẫn còn mang seed text tiếng Anh của nền tảng, chẳng hạn trạng thái rỗng của một repeater ghi "No products yet" — trước đây không khớp với rule nào nên review vẫn báo sạch.
- sb_review giờ báo cáo form_fields_flush khi một form, form-segment hoặc form-step-nav xếp các field mà không có gap, khiến mỗi label đọc như thể thuộc về control phía trên nó.
- CLI cài đặt giờ nhận --site-name, khớp với flag mà dòng lệnh cài đặt của chính Agent app trên nền tảng đã thêm vào; giá trị này đi kèm dưới dạng SB_SITE_NAME cùng với site id, và sb_connect báo cáo lại giá trị này để một session có thể hiển thị tên cửa hàng thay vì id.
- Một dry run của CLI cài đặt giờ báo cáo kết quả xem trước và exit code riêng, thay vì dùng chung dấu hiệu thất bại và exit code của một lần cài đặt thật.
- sb_api_call giờ fallback các path parameter {siteId} và {siteID} về SB_SITE trên toàn bộ 289 operation có tên site, khớp với cách fallback mà mọi tool khác đã áp dụng qua siteFor(); một tham số được truyền rõ ràng vẫn được ưu tiên.

### Fixed
- Tham số state của sb_set giờ ghi đúng vào vị trí mà cascade của nền tảng thực sự đọc: node.states[state] ở base, node.responsive[breakpoint].states[state] theo từng breakpoint. Trước đây nó ghi vào một đường dẫn không ai đọc, và base:true kết hợp với state:"hover" ghi thẳng giá trị hover vào style thường, khiến node mang màu hover vĩnh viễn mà không hề có trạng thái hover.
- sb_set giờ từ chối tham số state trên specials thay vì âm thầm bỏ qua, vì nội dung và identity không thay đổi theo trạng thái tương tác.
- sb_review giờ đi vào cả các node vệ tinh (trạng thái rỗng của repeater, skin của một variant option, các nút của quantity stepper, skin của một mục menu hoặc tab), nên các finding bên trong chúng được báo cáo thay vì vô hình với mọi check.
- sb_review và sb_set giờ báo cáo một chỉnh sửa có phạm vi toàn site đúng như bản chất của nó: thay đổi một node bên trong phần thân của một global section, hoặc bên trong một overlay của site như cart drawer, giờ được gắn cờ thay vì đọc như một chỉnh sửa cục bộ trên trang.
- sb_look giờ mở một overlay đang đóng (như cart drawer) trước khi đo, nên một node_id nằm bên trong overlay đó giờ có thể được chụp ảnh, thay vì thất bại với lỗi clip không nêu rõ overlay hay lý do.
- preview_note của sb_look không còn khẳng định rằng bản xem trước bản nháp render trạng thái rỗng của mọi repeater; bản xem trước bản nháp truyền dữ liệu cửa hàng thật giống như một trang đã publish, và ghi chú giờ mô tả đúng lưu ý thực sự — đó là một entity template xem trước sẽ không có gì được bind.

## [0.4.4] - 2026-09-08

### Added
- sb_api_find giờ trả về body_shape cho 158 trong tổng số 212 write operation của nền tảng, đọc trực tiếp từ handler Go giải mã từng body thay vì chỉ 46 operation mà swagger.json mô tả, và mở rộng thêm một cấp cho struct lồng nhau (như variants của một sản phẩm, nơi giá thực sự nằm ở đó) thay vì dừng lại ở tên kiểu.
- sb_store chạy bốn lượt ghi theo đúng thứ tự cố định mà một checkout hoạt động cần — tạo order form, lưu lại nguyên vẹn với giỏ hàng làm nguồn, điền các phương thức thanh toán và tùy chọn giao hàng thật của cửa hàng, rồi tạo và publish một trang kiểu checkout — vì tự dựng bằng tay mà bỏ sót một bước sẽ cho ra nút Checkout luôn trả về 404. dry_run (mặc định) trả về plan theo đúng thứ tự cùng payment_methods/delivery_options mà form sẽ mang; khi thực thi sẽ trả về form_id, page_id, slug và published.
- sb_undo khôi phục lại thứ mà một PUT qua sb_api_call vừa ghi đè, vì nền tảng không có lịch sử, phiên bản hay khôi phục cho trang, form hay settings; sb_api_call giờ đọc đối tượng của một PUT qua GET tương ứng trước khi ghi, để có thứ mà khôi phục lại.

### Fixed
- Gap checkoutPage của sb_review giờ trỏ tới action checkout của sb_store thay vì một cách sửa chỉ tạo trang kiểu checkout, vốn không có order form gắn với giỏ hàng nên không nhận được đơn hàng nào.
- Việc redact một bản xem trước request (dùng bởi sb_api_call và sb_undo) giờ khớp với các tên trường credential có nguồn gốc từ nền tảng như accessKey, apiKey, clientSecret, hashSecret, webhookSecret, orderToken và signature, chứ không chỉ khớp chính xác "secret", vì body mà sb_undo phản chiếu lại đến từ vocabulary của nền tảng chứ không phải của caller.

## [0.4.3] - 2026-09-08

### Changed
- sb_look và mọi lần lưu khác giờ không còn ghi lại một document không đổi lên nền tảng, vì một vòng lặp thị giác thường "xem" nhiều hơn hẳn số lần "sửa", và một lần lưu không thay đổi gì vẫn tốn một round trip và làm tăng revision của mọi bản gốc dùng chung mà trang đó mang theo; lần lưu giờ sẽ dừng sớm khi revision của document khớp với revision đã lưu gần nhất.
- sb_look bỏ qua bước duyệt cuộn để chờ ảnh lazy khi trang không có phần tử nào mang loading="lazy", thay vì luôn tốn ~60ms cuộn dù trang không có gì bên dưới màn hình cần ổn định.
- Catalog API được tạo lại: 481 operation (tăng từ 456), khôi phục 25 route merchant trước đây chỉ được ghi trong comment route-map và không thể gọi qua sb_api_call, bao gồm các route chi tiết của article và blog-category, các phần section/lesson/product-link/lượt đăng ký của một khóa học, một integration, và các site template.
- Một số nhãn trait của order-receipt được rút gọn (receipt_number_label, receipt_placed_label, receipt_status_label, receipt_items_label, receipt_total_label, receipt_due_label, receipt_unavailable_text), ví dụ "Order number label" thành "Order number".

## [0.4.2] - 2026-09-08

### Changed
- sb_look giờ chờ trang ngừng thay đổi (dùng MutationObserver, 250 ms yên tĩnh / giới hạn 2000 ms) thay vì chờ timeout networkidle mà cart island liên tục polling và các kiểm tra session của storefront không bao giờ thỏa mãn được, rút ngắn một lần chụp điển hình từ ~3.2s xuống dưới 1s, đồng thời vẫn chụp ảnh một trang không bao giờ ổn định thay vì giữ mãi không chụp.

## [0.4.1] - 2026-09-08

### Fixed
- sb_review giờ báo cáo các finding bên trong cart drawer và các overlay khác của site, gắn cờ overlay: true, thay vì âm thầm bỏ qua chúng vì cho rằng một overlay không phải trách nhiệm của trang; thông báo review giải thích rằng một finding có overlay: true được sửa theo cùng cách nhưng có phạm vi toàn site, nên chỉ cần sửa một lần.
- path_params của sb_api_call giờ khớp tên tham số không phân biệt hoa thường như một phương án dự phòng, nên một lời gọi dùng cách viết phổ biến siteId không còn thất bại với 8 operation viết là siteID; một khớp chính xác vẫn được ưu tiên và một tham số thực sự thiếu vẫn bị từ chối.

## [0.4.0] - 2026-09-08

### Added
- sb_review giờ báo cáo gap catalogue khi site chưa có sản phẩm active nào, vì mọi repeater trên site sẽ render trạng thái rỗng và product template không bind vào đâu cả trên một cửa hàng vốn báo cáo là đã sẵn sàng.
- sb_review giờ báo cáo cùng gap catalogue khi mọi sản phẩm active đều có giá bằng không, vì một sản phẩm giá 0 vẫn render, vẫn thêm được vào giỏ hàng và tổng đơn hàng bằng không.

## [0.3.0] - 2026-09-08

### Added
- sb_event giờ có thể gán một click action lên bất kỳ node nào (như open_cart), với danh sách hành động hợp lệ cho từng element đọc từ catalog; một hành động mua hàng bị từ chối ở đây và được chỉ sang sb_bind thay vì âm thầm chấp nhận mà không làm gì.
- sb_bind nhận tham số action, nên giờ đã có thể tạo được nút mua hàng: binding ghi id cố định bind-product-action và lưu buy_now dưới dạng dynamic_checkout của chính document — đây là thứ mà renderer đọc để quyết định một nút có phải nút mua hàng hay không.
- sb_outline giờ liệt kê các node vệ tinh (skin của một mục accordion, nút dùng chung của tab, các nút và ô nhập của quantity stepper, trạng thái rỗng của một repeater) dưới owner của chúng dưới dạng satellite: "<config key>" — một loại node trước đây vô hình với mọi tool giờ đã có mặt trên bản đồ; nó không được tính vào children.
- sb_review giờ báo cáo gap accountPage và searchPage khi cửa hàng chưa có trang cho đường dẫn cố định /account hoặc /search, bên cạnh các gap checkout/gateway/product/shipping/cartTrigger đã có.
- CLI cài đặt giờ nhận --site (và từ chối mọi flag không nhận diện được thay vì âm thầm bỏ qua), ghi SB_SITE để mọi tham số site_id fallback về giá trị này qua siteFor().
- Một response 204 (như xóa trang) giờ báo cáo đã làm gì thay vì trả về null.

### Changed
- sb_look giờ duyệt qua toàn bộ trang trước khi chụp ảnh fullPage, nên một ảnh lazy-load dưới màn hình không còn bị chụp thành hộp trống.
- sb_review không còn báo cáo empty_container cho một media-dataset đã bind, vì element này tự vẽ record và không cần child; cũng không còn báo off_canvas cho các node bên trong cart drawer, vốn nằm ngoài màn hình cho tới khi shopper mở nó ra.
- Các dataset element của sb_add (list-dataset, dataset-block, media-dataset, collection-media, product-variants, quantity-dataset, và các loại khác) giờ tính binding dựa trên config.datasetSource được truyền trong cùng lời gọi, thay vì luôn seed theo nguồn mặc định của element; sb_set sửa một binding sai lệch theo cùng cách.
- Thông báo lỗi của sb_site_list không còn bảo một cài đặt chỉ dùng key phải gọi sb_connect trước, vì liệt kê site là một lời gọi cấp tài khoản mà key không thể thực hiện được.
- Lỗi của sb_api_call khi thiếu path parameter giờ nói rõ tham số đó thuộc path_params thay vì chỉ nêu tên tham số mà không nói nó nằm ở đâu.
- sb_media_upload giờ thử lại trên endpoint upload phía đối tác trước khi báo lỗi do quyền của key, vì một bản triển khai chưa bật upload bằng key trên endpoint chính trước đây sẽ đổ lỗi sai cho một key hợp lệ.
- Catalog API được tạo lại: 456 operation và 99 definition (tăng từ 412 và 97), khôi phục 44 operation trước đây chưa được ghi nhận, bao gồm các endpoint đọc/ghi payment-gateway; catalog element tăng lên 107 với việc bổ sung order-receipt.

### Fixed
- Lưu một chỉnh sửa vào global section dùng chung hoặc một overlay (cart drawer, header hoặc footer dùng chung) không còn âm thầm làm mất mọi chỉnh sửa sau lần đầu tiên trong một phiên; lần lưu giờ cập nhật lại revision của từng bản gốc từ response của nền tảng thay vì gửi lại một revision cũ mà nền tảng từ chối kèm mã 200.

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
