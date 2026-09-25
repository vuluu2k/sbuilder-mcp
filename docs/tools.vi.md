# Bộ tool

Bốn tool với tới 495 operation của nền tảng, và 166 trong 216 lệnh ghi trong số đó mang theo
hình dạng body đọc thẳng từ handler decode chúng. `sb_api_find` là một chỉ mục, không phải mỗi
endpoint một tool — [lý do](../README.vi.md#bộ-tool).

Mọi kết quả đều là **JSON nén** — không thụt lề, vì người đọc là model và khoảng trắng chiếm
15 % mỗi câu trả lời. Một directive (`findings_notice`, `layout_notice`, `note`,
`boxes_format`) chỉ nói **một lần mỗi process**, sau đó trường ấy đơn giản là vắng mặt: một
chỉ dẫn lặp lại ở mọi lần gọi thì tới lần thứ ba là bị đọc lướt. Mọi tool đều mang MCP
annotation — `readOnlyHint` trên mười hai tool chỉ đọc, `destructiveHint` trên `sb_remove`,
`sb_api_call` và `sb_page_create` nhận `name` cùng `type`, `slug`, `is_homepage` và `settings`. **TYPE CHÍNH LÀ
ĐƯỜNG ĐI** với vài loại trang: `checkout`, `product`, `category`, `post` và `course` được
định tuyến theo type chứ không theo slug, nên `/checkout` và `/products/{slug}` trả 404 cho
tới khi có một trang loại đó ĐƯỢC PUBLISH. Bỏ trống thì đọc từ tên — "Giới thiệu", "Liên hệ", chính sách, hỏi đáp thành `about`, `contact`, `policy`, `faq` (icon riêng, slug riêng, mở sẵn layout cùng tên) — còn lại là `page`. Thiếu tham số này thì agent có
thể dựng một cửa hàng không ai mua được — đúng khoảng trống đầu tiên mà `sb_review` báo.

`sb_publish` — nên client nào tôn trọng chúng sẽ thôi hỏi người dùng xác
nhận một lần đọc.

---

## `sb_connect`

Đăng nhập và báo cáo server này với tới được gì. **Gọi cái này trước tiên.**

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `email` | string? | Mặc định lấy `SB_EMAIL` |
| `password` | string? | Mặc định lấy `SB_PASSWORD` |

Trả về `{ user, sites: [{id, name}], api_key: "present"|"missing", operations, note? }`.

Thiếu `SB_TOKEN` thì **báo chứ không ném lỗi**: nửa bề mặt dùng phiên vẫn chạy được, và
làm hỏng cả lệnh connect sẽ che mất điều đó với người không hề đụng `/api/v1`. Mật khẩu
không bao giờ được lặp lại trong kết quả.

## `sb_site_list`

Liệt kê các site tài khoản vận hành được. Không có tham số.

## `sb_api_find`

Tìm operation theo ý định, rồi đọc call sheet của một operation. Hai chế độ trên cùng một
tool, chọn bằng tham số — truyền `query` hoặc `id`.

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `query` | string? | Bạn muốn làm gì, viết bằng lời — **tìm kiếm** |
| `id` | string? | Một id từ lần tìm trước — **call sheet** của nó |
| `tag` | string? | Thu hẹp lần tìm theo một tag: `menus`, `products`, `theme`, … |
| `limit` | number? | Mặc định 8, tối đa 50 |

**Tìm kiếm** trả về `{ matches, next }`, mỗi kết quả một dòng:
`{ id, method, path, summary, credential, params, body?, summary_shared? }`. `params` liệt kê
tên các tham số không phải body, tham số tuỳ chọn có tiền tố `?` (`["siteID", "?limit"]`);
`body` là một từ — `described`, `undescribed` hoặc `none_declared` — và vắng mặt với
operation đọc. `summary_shared` đánh dấu một summary mà nền tảng viết cho nhiều route cùng
lúc: hãy đọc path, đừng tin câu chữ. Không có tag, không có schema: mười hai kết quả kèm
schema inline từng đo được 44 KB, cho một danh sách mà agent chỉ gọi đúng một mục. `next`
nhắc truyền một id lại để lấy call sheet.

**Call sheet** (`id`) trả về operation đầy đủ — `params` có kiểu, `tags`, `credential` — kèm
**một** kết luận về body:

| Trường | Nghĩa |
| --- | --- |
| `body_shape` | Các trường handler thật sự decode, đọc từ mã nguồn Go của nền tảng: `{ fields: [{ name, type, note? }], readOnly?, goType, source: "go" }`. Phủ 158 trong 212 write operation |
| `body_schema` | Swagger giải được `$ref` và không tìm thấy shape từ handler |
| `body_warning` | Có khai báo body nhưng không gì mô tả hình dạng. Hãy đọc GET tương ứng rồi sửa một bản sao |
| `body_note` | Hoặc một operation ghi mà **không** khai báo body nào — đôi khi đúng (`POST /orgs/{id}/leave` là một hành động thuần), đôi khi chỉ là thiếu annotation — hoặc một operation ĐỌC mà body khai báo là bản sao nguyên văn của một write bên cạnh, và nó gọi tên route nguồn đó |

Không bao giờ có quá một trong bốn, và `body_shape` được ưu tiên trước. Ưu tiên vì handler là
mã thật sự chạy: `swagger.json` mô tả 46 trong 212 write body, và nó gắn `@Param body` của
một khối doc comment cho **mọi** dòng `@Router` bên dưới, nên một GET danh sách có thể nhận
là có body mà nó không nhận. Điểm decode thì nằm gọn trong đúng một `case http.Method*`.

Chính kiểu chồng khối doc đó cũng sao chép **câu chữ** và **tham số**, và call sheet giờ sửa
cả hai:

- `summary_covers` gọi tên những route khác mà một summary dùng chung được viết cho. 302
  trong 524 operation dùng chung summary; phần lớn là câu bao trùm và đúng với từng thành
  viên ("List, create, update or delete a course's lessons"), nên chỉ 41 operation có đoạn
  path cuối KHÁC nhau mới bị đánh dấu — một câu chỉ có thể mô tả nhiều nhất một trong số đó.
  Tốn kém nhất là tiền: `/payment-transactions/{id}/refund` chỉ GHI NHẬN một khoản hoàn đã
  trả ở nơi khác, còn `/refund-via-gateway` mới là cái yêu cầu cổng thanh toán chuyển tiền
  về, mà tài liệu cho cả hai cùng một câu.
- Một operation đọc khai báo body **giống hệt từng byte** với một write nào đó sẽ được báo là
  bản sao thay vì inline schema — đo được ~83 KB schema body trên 90 call sheet GET và
  DELETE, cho những body mà chính route đó không nhận.
- `params` liệt kê mỗi tham số **một lần** (29 operation từng lặp lại), và bao gồm mọi
  `{param}` mà path khai báo — 30 operation có tham số nằm trong path nhưng không có `@Param`
  nào, nên call sheet đòi ít hơn thứ lệnh gọi thật sự cần.

`note` của một trường là doc comment của chính trường đó, cắt còn câu đầu cộng mọi câu viết
hoa nhấn mạnh — chỗ nền tảng này cất thứ quyết định một body. `shipping.Method` ghi
`freeOverCents` là *"ZERO MEANS 'never free', not 'always free'"*, và một shape thiếu câu đó
tạo ra cửa hàng giao mọi thứ miễn phí. `readOnly` liệt kê những trường nền tảng sở hữu, đọc
từ chính các type `Omit<…>` của editor, để lệnh create không cố gửi `id`.

Phân biệt giữa hai mục cuối vẫn chịu lực: coi `body_note` là "không nhận body" sẽ gửi một
PUT rỗng và xoá trắng một trang.

Cách chấm điểm là đếm từ khoá có trọng số theo trường (tag 5, path 3, tóm tắt 2), hoà thì
xếp theo id. Cố ý không dùng fuzzy — một danh sách rỗng thì dễ chữa, còn một operation sai
mà trông chắc chắn thì không.

### Lấp đầy một catalogue

Bốn operation tạo hoặc thay toàn bộ một product mang thêm ghi chú `product_traps` — ba sự
thật một body shape không nói được. **Giá nằm ở variant**: `products.Product` không có cột
giá, nên một product gửi lên không kèm `variants[]` là một mục catalogue không ai mua được.
**Slug trùng bị ĐỔI TÊN, không bị từ chối** — lệnh ghi vẫn trả 200/201, nên chạy lại một lần
import không báo lỗi mà nhân đôi catalogue trong im lặng. **Ảnh có thể lấy trực tiếp từ
URL**: `POST /api/media/{siteId}/from-url` chạy đúng luồng ingest mà cửa upload dùng, đi một
chặng thay vì tải xuống rồi upload lại.

## `sb_api_call`

Chạy một operation tìm được bằng `sb_api_find`.

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | string? | Operation id lấy từ `sb_api_find`. Bỏ trống để gọi bằng `method` + `path` |
| `method` | string? | Cùng với `path`, khi không có `id`: `GET`, `HEAD`, `POST`, `PUT`, `PATCH` hoặc `DELETE` |
| `path` | string? | Một path trần của platform, bắt đầu bằng `/`, ví dụ `/api/sites/{siteId}/published`; `{siteId}` mặc định lấy từ `SB_SITE` |
| `path_params` | object? | Mọi `{name}` trong path; thiếu một cái là bị từ chối, giá trị được URL-encode |
| `query` | object? | Query string; giá trị `undefined` bị bỏ |
| `body` | any? | Thân yêu cầu |
| `dry_run` | boolean? | **Mặc định `true`** — không gửi gì, trả về bản xem trước đã che bí mật |
| `pick` | string[]? | Các field giữ lại trên mỗi item của một câu trả lời dạng danh sách (hoặc trên item duy nhất của câu trả lời `{ page: {…} }`) |
| `max_items` | number? | Trần số item của một danh sách, áp sau phân trang của chính nền tảng |
| `item_offset` | integer? | Bỏ qua số item này trong danh sách trả về (mặc định 0); giá trị dương chỉ dùng với GET/HEAD |

Credential chọn theo path chứ không theo tham số: `/api/v1/…` dùng `SB_TOKEN`, còn lại
dùng phiên. Thiếu `SB_TOKEN` thì báo đích danh tên biến, thay vì để nền tảng trả
`401 api_key_required` — cái đó đọc lên giống lỗi phân quyền.

**Route không có trong catalog vẫn gọi được.** Catalog là một danh sách đóng đọc từ một tài
liệu swagger, còn platform phục vụ cả những route tài liệu đó không mô tả — 20 route chưa
từng được annotate, ba route đăng ký thẳng trên router (`/api/permissions`, `/api/plans`,
`/api/locales`), và mọi thứ mới hơn lần regen gần nhất. `method` + `path` gọi tới chúng theo
đúng các quy tắc cũ: credential theo tiền tố path, `dry_run` mặc định `true`, `{siteId}` lấy
từ `SB_SITE`, và `pick` / `max_items` / `item_offset` vẫn áp dụng. Một cặp `method` + `path`
gọi trúng route đã có trong catalog thì được trả lời như một operation trong catalog, kèm
shape và undo, và không bị bọc lại. Việc khớp đó làm theo từng đoạn path, nên một path mang
id thật (`/api/sites/abc123/menus/m1`) cũng khớp được như path viết tham số — các id thật
trở thành giá trị cho tham số mà route trong catalog đặt tên. Route nói rõ về chính nó hơn
sẽ thắng (`…/pages/locate-nodes` hơn `…/pages/{pageId}`), và hai route cùng mức cụ thể thì
không khớp vào đâu cả và vẫn là raw, thay vì bị đoán bừa.
Thứ một raw call KHÔNG có được nói một lần mỗi process — là `directive` khi dry run, là
`note` khi gửi thật: không call sheet, không body shape, không cảnh báo body và không
`sb_undo`.
Kết quả được bọc thành `{ uncatalogued: true, data }` để không nhầm với kết quả có trong
catalog. Một path không phải path trần của platform bị từ chối, vì base URL là `SB_API` của
bản cài này và một path mang host sẽ gửi credential đi nơi khác. Một path mang query string
hoặc fragment cũng bị từ chối — query thuộc về `query`, không phải `path`. Khi
`sb_api_find` không khớp gì, câu trả lời liệt kê ba route chỉ-có-trên-router dưới
`outside_catalog`.

Một lệnh gọi thất bại mang đúng một hình dạng lỗi của nền tảng, `{ error, code }`, và — khi
nền tảng gửi kèm — `details` và `fields`. Lỗi `validation` nêu đích danh trường sai trong
thông điệp, nên một 400 nói rõ *trường nào* chứ không chỉ nói là có một trường sai.

**Định hình kết quả.** Một danh sách sản phẩm là năm mươi object 2 KB chỉ để lấy id và tên.
Câu trả lời dạng danh sách của nền tảng (`{ <tên>: [...], total }`, hoặc một mảng trần) được
định hình cho người đọc: `pick` giữ các field được nêu trên mỗi item, `max_items` cắt danh
sách, và danh sách vẫn quá **60.000 ký tự** thì bị cắt cho vừa. Mọi lần cắt đều được nói ra —
`truncated: { shown, of, hint }` cho biết trả về bao nhiêu, có tất cả bao nhiêu, và cách thu
hẹp lệnh gọi (`pick`, `max_items`, hoặc query `limit`/`offset` của chính operation). Câu trả
lời không phải danh sách thì không bao giờ bị cắt: không có chỗ nào trung thực để dừng giữa
một object.

Kết quả bị cắt còn có `offset` và `next_item_offset` nếu có thể đọc tiếp. Truyền giá trị
sau vào `item_offset`, giữ nguyên GET và query để đọc phần kế tiếp, kể cả khi API không hỗ
trợ phân trang. Mỗi lần gọi tải lại danh sách, không giữ snapshot: dữ liệu thay đổi đồng
thời có thể làm vị trí item dịch chuyển. Ưu tiên phân trang của API nếu có; tham số này
không lấy được bản ghi ngoài trang hiện tại của API. Không gọi lại thao tác ghi chỉ để
đọc tiếp kết quả; offset dương trên thao tác ghi bị từ chối. Nếu riêng một item đã vượt
trần, thu hẹp `pick` trước; không trả con trỏ khiến việc đọc tiếp lặp mãi tại chỗ.

Nếu `pick` không khớp field nào trong danh sách, giữ field gốc và báo `shaping_note`,
vẫn áp phân trang và giới hạn dung lượng thay vì trả toàn `{}`.

Ba luật lặng lẽ hơn, mỗi luật tồn tại vì phương án còn lại làm mất dữ liệu mà không nói. Một
câu trả lời **không có danh sách duy nhất** — ví dụ hai mảng — được trả về nguyên vẹn kèm
`shaping_note`, thay vì bị định hình thành thứ nền tảng chưa từng gửi; `pick` không khớp
trường nào cũng vậy, vì `{}` đọc lên như "nền tảng không trả gì". Nếu chính câu trả lời của
nền tảng đã có trường `truncated`, thông tin cắt sẽ nằm ở `_truncated` chứ không ghi đè. Và
khi riêng phần không phải danh sách đã vượt trần, không cắt thêm vì dung lượng — bỏ bớt
item cũng không giúp — và ghi chú nói rõ vì sao.

---

# Bộ tool cho trang

Chín tool nữa để thiết kế chính trang đó. `sb_page_open` phải gọi trước; các tool còn lại
thao tác trên đúng một tài liệu đang mở.

## `sb_page_open`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `site_id` | string? | Mặc định lấy `SB_SITE` |
| `page_id` | string | |

Mọi tool nhận `site_id` đều coi nó là tuỳ chọn và lùi về `SB_SITE` — một khoá chỉ thuộc
một site, nên bản cài đã biết sẵn. Tham số truyền tay luôn thắng.

Nạp tài liệu **bản nháp** của trang và trả về outline. Thứ nhận được đã *ghép sẵn*: global
section, site overlay và app block đã được gộp lên ROOT. Findings đi kèm, đúng hình dạng
`sb_review` trả về — xem bên dưới.

**SATELLITE CÓ TRÊN BẢN ĐỒ.** Tám kiểu element sở hữu node treo ở `config[<key>]` chứ không
ở `data.nodes` — ô chọn biến thể, hai nút của bộ đếm số lượng, trạng thái rỗng của repeater —
và chúng giữ toàn bộ diện mạo của element. Chúng được liệt kê dưới chủ sở hữu kèm
`satellite: "<khoá config>"`, đứng trước các con thật, và **không** được tính vào `children`:
con số đó vẫn là `data.nodes.length`, thứ mà mọi lệnh nhận index được viết theo. Style chúng
bằng `sb_set` như node bình thường; chúng nhận cả `state`, nên hover và ô đang chọn là của bạn.

**`blank_page_repair`** xuất hiện khi tài liệu đã lưu đặt tên gốc là `rootId` (tên mà app
block và section template dùng cho cùng ý niệm) thay vì `root_node_id`. Bộ render trang
không tìm thấy gốc, không duyệt gì cả và xuất bản một trang trả 200 với `<body>` rỗng — gặp
thật trên trang hoàn tất đơn của một storefront đang chạy, khách vừa trả tiền xong thì thấy
màn hình trắng. Tài liệu được nhận vào chứ không bị từ chối, nên lần lưu kế tiếp ghi đúng
khoá chuẩn và trang hiện lại.

**`compose_warnings`** trả về khi platform báo có thứ nó không compose được.
`globalMissing` là trường hợp phá hoại: server không tìm thấy master nên đã XOÁ
node tham chiếu khỏi cây vừa trao cho bạn — trang mở ra đã mất sẵn section đó, và
lưu lại sẽ khiến mất vĩnh viễn. Các mã còn lại (`globalStale`, `overlayStale`,
`appBlockMissing`, `appBlockEdited`, `formMissing`) cho biết thứ gì bị từ chối hoặc
bị rút gọn. Response vẫn luôn mang theo chúng; trước nay không ai đọc.

## `sb_outline`

`depth` (1–6, mặc định 1). Mỗi node một dòng: `id`, `type`, `name`, `children`, kèm `band`
(`header`/`middle`/`footer`), `global: true` nếu là master dùng chung, `overlay: true` nếu
là site overlay, và `app: true` nếu là gốc của một app block đã ghép — không sửa được gì
bên dưới nó. **Không bao giờ trả tài liệu thô** — một trang thật nặng hàng trăm KB.

## `sb_node_read`

`id`. Một node đầy đủ. Kèm `warning` nếu node đó là global dùng chung.

**Nhiều node một lần.** Việc làm sau một lần look là "nâng heading này, mở rộng card kia, đổi
màu nút" — đưa chúng vào `edits` thì chỉ còn một batch patch, một lần lưu và một frame live
thay vì mỗi node một bộ. Mọi edit được kiểm tra trước khi phát ra bất kỳ patch nào, nên một
id sai ở edit thứ tư từ chối cả batch. Kết quả khi đó là `{ set: [{ id, keys }], rev,
warnings? }` với `warnings` khoá theo id node.

## `sb_catalog_search`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `query` | string | Element cần làm gì |
| `limit` | number? | Mặc định 8, tối đa 30 |
| `detail` | boolean? | Thêm `useWhen`, `avoidWhen`, `contentTips` vào mọi kết quả |

Tìm trong chính AI hints của nền tảng trên cả 106 element. Mỗi kết quả là
`{ type, label, category, description }`, kèm `isContainer: true` / `isRootOnly: true` chỉ
khi đúng — bốn trường để **chọn**. Bản thân các hint, do đội nền tảng viết đúng cho mục đích
này, đi kèm `sb_traits_for` của element đã chọn, hoặc kèm mọi kết quả khi `detail: true`;
hint của mười kết quả từng tốn 7 KB cho một lựa chọn vốn chỉ dựa vào description.

## `sb_traits_for`

`type`, `control?`. Không có `control`: AI hints của element, inspector của nó dưới dạng tên
tab → nhóm → control, mọi control có đích ghi khai báo sẵn ở dạng đầy đủ, default được gieo
sẵn và luật chứa con — hình dạng ở mục [Thiết kế như người thật](#sb_traits_for--inspector-không-phải-bản-tóm-tắt).
Có `control`: đúng một control đó, đầy đủ.

## `sb_add`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `parent_id` | string | |
| `spec` | object | `{ type, name?, style?, config?, specials?, children? }` — **lồng nhau** |
| `index` | number? | Mặc định nối vào cuối |
| `dry_run` | boolean? | Mặc định true |
| `force` | boolean? | Bỏ qua một guard mềm; thông điệp được trả về trong `forced[]` thay vì ném lỗi. Guard cứng bỏ qua tham số này — xem "Mỗi lần ghi kiểm tra gì" |

Truyền `children` để dựng nguyên một section trong một lần gọi. Từ chối element root-only
đặt trong section, con nằm ngoài whitelist của cha, và mọi lần thêm vào node không phải
container.


Phần tử vừa tạo mang sẵn BINDINGS mà kiểu của nó cần: `text-dataset` đã đọc `product.title`,
`pricing-dataset` có đủ sáu khoá giá, `list-dataset` có target repeater. Editor suy chúng lúc
kéo thả và defaults của element không mang, nên trước đây mọi phần tử dữ liệu server này tạo
ra đều lưu được, publish được và render mãi placeholder.

## `sb_set`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | string | |
| `namespace` | `style` \| `config` \| `specials` | |
| `keys` | object | Có thể bỏ khi `unset` đã làm phần việc |
| `unset` | string[]? | Các key cần XOÁ khỏi đúng slot đó — cách duy nhất để hoàn tác một lần ghi. Đặt `null` không tương đương: null là một giá trị được lưu, nên override vẫn bị tính là đang tồn tại |
| `breakpoint` | `desktop` \| `laptop` \| `tablet` \| `mobile` | Mặc định `desktop` |
| `base` | boolean? | Ghi ở base thay vì theo breakpoint |
| `edits` | array? | Nhiều node trong một lần gọi: `[{ id, namespace, keys, breakpoint?, base?, state?, unset? }]`; các tham số một-node ở trên khi đó bị bỏ qua |
| `dry_run` | boolean? | Mặc định true |
| `force` | boolean? | Bỏ qua một guard mềm; thông điệp được trả về trong `forced[]` thay vì ném lỗi. Guard cứng bỏ qua tham số này — xem "Mỗi lần ghi kiểm tra gì" |

**Base và breakpoint.** `sb_set` mặc định ghi theo breakpoint, vì một thiết kế nên đáp ứng. Base cũng hợp lệ — cascade giải một khoá theo thứ tự *slot hiện tại → rộng hơn → base → hẹp hơn*, nên base là lớp dự phòng, và là chỗ default của chính mỗi element được gieo vào. Dùng base cho giá trị thật sự không nên thay đổi.

`specials` luôn ở base: nội dung không phải đại lượng.

Chạy khô trả về `patches` và, lần đầu trong một process, một `note` nhắc lại luật base và
breakpoint ở trên. Ghi thật trả về các khoá đã set và `rev` mới, kèm `warning` nếu node là
global dùng chung.


**Phần tử dữ liệu đi theo dữ liệu của nó.** Ghi `config.kind` hoặc `config.datasetSource` sẽ
suy lại luôn bindings của phần tử đó, vì bindings CHÍNH LÀ hàm của hai khoá này. Để nguyên
thì một text-dataset chuyển từ tên sản phẩm sang tên bộ sưu tập vẫn đọc `product.title`, mà
ngoài trang sản phẩm thì khoá đó không giải ra gì: nó render rỗng và không nói gì. Cặp giá
trị mà bảng sinh sẵn không biết thì giữ nguyên bindings chứ không xoá — bind sai đã tệ, không
bind còn tệ hơn.

**`globalId`, `appBlockId` và `appBlockHash` bị từ chối.** Đó là dấu MÁY CHỦ đóng khi nó ghép
một cây con dùng chung lên trang; tài liệu THAM CHIẾU tới nó bằng `globalRef` / `appBlockRef`.
Tự viết dấu đã-ghép thì lần lưu kế tiếp sẽ rã node của bạn đè lên master, làm trống nó cho
mọi trang mang nó. Không phải giả định: một lần chạy đã làm trắng bốn trang. Cả `sb_add` lẫn
`sb_set` đều từ chối và nêu đúng khoá cần dùng.

## `sb_move` / `sb_remove`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `force` | boolean? | Bỏ qua một guard mềm; thông điệp được trả về trong `forced[]` thay vì ném lỗi. Guard cứng bỏ qua tham số này — xem "Mỗi lần ghi kiểm tra gì" |

`sb_move` nhận `id`, `parent_id`, `index`. `sb_remove` nhận `id` và xoá cả cây con. Cả hai
từ chối đụng vào **site overlay** — nó được ghép lên ROOT lúc đọc và bóc ra lúc ghi, nên sửa
ở đây lúc lưu sẽ không có tác dụng gì — và mọi thứ **bên trong app block**, cùng lý do.
`sb_move` từ chối chuyển node vào chính hậu duệ của nó, việc sẽ tách rời cây con đó mà không
báo gì, và từ chối chuyển *vào* một app block.

## Mỗi lần ghi kiểm tra gì trước khi lưu

Năm luật của nền tảng, được viết thành code có test chứ không phải ghi chú:

1. **Thứ tự băng** — con của ROOT phải đọc `[header][middle][footer]`. Sai là nền tảng từ
   chối *mọi* lần lưu (`ErrBandOrder`).
2. **Overlay** bị loại khỏi mọi luật cấp ROOT, đúng như nền tảng loại nó trước khi tự kiểm.
3. **Global** là master dùng chung; mọi kết quả đụng tới nó đều kèm cảnh báo rằng sửa nó là
   sửa mọi trang, và publish thì lan.
4. **Luật responsive** — xem `sb_set` ở trên.
5. **App block** — xem ngay dưới.

### App block

Một app trên marketplace đóng góp nguyên một cây con vào trang. Tài liệu chỉ lưu **một node
tham chiếu**, đóng dấu `specials.appBlockRef`; lúc đọc nền tảng dựng markup của app bên dưới
nó và đóng dấu `appBlockId` lên gốc block; lúc lưu `DecomposeAppBlocks`
(`server/internal/page/globalservice.go:56`, sau overlay, trước `Decompose`) thu cả cây con
về lại đúng node tham chiếu đó. Nên một sửa đổi bên trong block đã ghép không được lưu ở đâu
và không được báo ở đâu — tài liệu cục bộ đúng, lần lưu thành công, và thay đổi biến mất.

Vì thế mọi lần ghi đều từ chối node **bên trong** block, nêu tên gốc block và nói rõ sửa đổi
sẽ mất: `sb_set`, `sb_bind`, `sb_remove` và `sb_duplicate` trên một hậu duệ thật sự, còn
`sb_add` hay `sb_move` thì với bất kỳ node nào của block — kể cả gốc — làm đích. Bản thân gốc
vẫn set, chuyển hoặc xoá được, vì nó *chính là* node tham chiếu và `specials.appBlockValues`
trên nó là nơi thiết lập của chủ cửa hàng nằm. Outline cắm cờ `app: true` cho nó, và
`sb_review` bỏ qua phần bên trong: placeholder ở đó là của app, không phải việc của trang này.

Cộng thêm tính toàn vẹn cây: không có id con trỏ vào hư không, không có con trỏ cha mâu
thuẫn với danh sách con, không có node nào không với tới được từ ROOT.

### `force`, và guard nào nhường nó

Guard ở đây có hai loại. Guard **mềm** khẳng định renderer làm gì — "key này biên dịch ra
không gì cả", "phần tử này không nhận con như vậy", "repeater này chỉ render con đầu tiên" —
dựa trên bản sao platform trong catalog, vốn có thể cũ hơn deployment bạn đang ghi vào. Lời
từ chối của nó kết thúc bằng `Pass force:true to write anyway.`, và với `force:true` lệnh
ghi vẫn đi, thông điệp quay về trong `forced: [...]`, cả ở dry run. Mềm: kiểm tra bên trong
và cha của app block, `childAllows` và root-only, template thứ hai dưới `list-dataset`, và
các kiểm tra stuck / stuck-after / reveal / hover-config / hover-host.

Guard **cứng** bảo vệ một bất biến chính platform thực thi hoặc một lệnh ghi không có đường
lùi, và `force` không bao giờ chạm tới: thứ tự band (platform từ chối save), stamp đã compose
(`globalId` / `appBlockId` làm trống master trên mọi trang), xoá hoặc nhân bản ROOT, loại
phần tử không tồn tại, root của overlay (bị bỏ khi ghi, nên lệnh ghi bị ép sẽ là no-op được
báo là xong), node chuyển vào chính cây con của nó, và `specials` kèm state. Lời từ chối cứng
không mang gợi ý `force`, đó là cách phân biệt mà không cần thử.

---

# Sửa trực tiếp và thị giác

## `sb_live_join`

`site_id`. Vào phòng live-edit của editor với tư cách một peer nhìn thấy được. Từ đó mọi
`sb_add` / `sb_set` / `sb_move` / `sb_remove` / `sb_bind` **đồng thời phát ra thành live op**,
nên ai đang mở editor sẽ thấy trang mọc dần, và con trỏ của agent di chuyển tới node nó đang
sửa — với điều kiện đã có số đo thật từ `sb_look`. Con trỏ với toạ độ bịa ra chỉ là diễn, nên
khi chưa đo thì con trỏ đơn giản là không nhúc nhích.

**Cần một phiên.** Socket live chỉ nhận session token — `realtime.go:38` từ chối API key —
và một lần xác thực socket bị từ chối vẫn bắn `onopen`, nên một agent chỉ có API key sẽ
"vào phòng", phát mọi sửa đổi vào khoảng không, và không bao giờ biết vì sao không ai thấy.
`sb_live_join` kiểm tra `SB_EMAIL` / `SB_PASSWORD` ngay từ đầu và từ chối kèm lý do. Mọi
tool khác đều chạy được chỉ với khoá.

**Luật nhường.** Client này không bao giờ là nguồn chân lý về tài liệu. Nó không trả lời yêu
cầu snapshot cho ai, và không phát checkpoint hội tụ nào của riêng nó. Gặp bất kỳ dấu hiệu
lệch nào — lỗ trong `seq` của server, checkpoint đến đúng seq của nó, một lần lưu bị từ chối
— nó vứt bản của mình và kéo lại từ server. Lần ghi kế tiếp được áp lại MỘT lần lên cây mới,
trừ khi phía bên kia đã sửa đúng node nó chạm tới hoặc còn sửa đổi chưa lưu — khi đó nó **báo
lỗi to** để người gọi đọc lại rồi làm lại. An toàn khi chạy cạnh người thật; người thật thắng
mọi bất đồng.

**Mọi lần ghi trang đều được báo vào phòng, dù đi qua cửa nào.** Một lần thay cả tài liệu —
`sb_api_call` `PUT …/pages/{id}/source` thô, `sb_page_repair`, một flow `sb_store` — được so
với bản đang lưu và phát thành op theo node cho ĐÚNG trang đó, khi có người trong phòng đang
mở trang ấy (thêm hai lần đọc, chỉ khi đó). Global section và overlay không cần gì: nền tảng
tự báo khi chúng được lưu. Ngoại lệ là đổi tên root: phòng không đồng bộ `root_node_id`, nên
editor đang mở phải tải lại mới thấy. Thay trang mà CHÍNH phiên này đang mở sẽ đánh dấu bản của
nó là cũ, nên lần sửa kế tiếp kéo lại trước, thay vì lưu bản cũ đè lên lần ghi đó.

## `sb_look`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `widths` | number[]? | Mặc định 1440 / 768 / 390 |
| `with_boxes` | boolean? | Mặc định true |
| `box_depth` | number? | Box cho các node tới độ sâu này trong cây. Mặc định 2, tối đa 8 |
| `node_id` | string? | Chỉ đóng khung element này thay vì cả trang |
| `format` | `"jpeg"` \| `"png"`? | `jpeg` (mặc định) nhỏ hơn và nhanh hơn; `png` khi cần màu chính xác từng pixel |

**Nó chụp trang đã LẮNG.** Mọi animation đều bị dừng trước khi cửa trập mở, vì một bức ảnh
tĩnh muốn thứ khách rốt cuộc nhìn thấy — không có bước này, một băng mang hiệu ứng hiện-dần-
khi-cuộn (`trigger: "view"`) sẽ chụp ra TRẮNG. Tiến độ của nó gắn với vị trí phần tử trong
khung cuộn, mà cú walk nạp ảnh lazy cuộn xong lại về đầu trang, nên băng đó quay về
`opacity: 0` đúng lúc chụp. Đo được: một băng trên bốn chụp ra rỗng trên một trang hoàn toàn
đúng. Script tự viết nào có chụp màn hình cũng phải làm y vậy.

**Lưu trước**, rồi mint link preview đã ký và render trang bằng chính renderer Go của nền
tảng — nên bức ảnh là của *bản nháp đã lưu*, không bao giờ là của sửa đổi chưa lưu. Trả về
một ảnh mỗi bề rộng, kèm `boxes`: một mảng các bộ `[id, type, x, y, w, h]` tính bằng CSS px
ở `widths[0]`, cho các node tới `box_depth` trong tài liệu đang mở — mặc định 2 là các băng
và con trực tiếp của chúng, đúng thứ một nhận định bố cục cần; ROOT luôn được giữ. Với `node_id`, độ sâu
tính từ node đó và chỉ cây con của nó được trả về. Chú giải một dòng `boxes_format` đi kèm lần look đầu tiên trong một process. Mọi node đã render (thuộc tính `id`) vẫn
được đo và giữ trong phiên cho con trỏ hiện diện và các kiểm tra bố cục; hai trăm object in
đẹp từng tốn 27 KB mỗi lần look. `with_boxes: false` bỏ chúng đi. Findings đi kèm như với
`sb_review`, và lỗi bố cục đi kèm dưới `layout` — xem cuối tài liệu này. Node nằm trong site
OVERLAY được đo nhưng không báo: cart drawer đỗ ngoài viewport cho tới khi khách mở, nên mọi
node trong đó đều đọc ra là off-canvas — hai chục finding trên một trang vốn đúng, mà không
cái nào sửa được từ trang đó.

**Một overlay được nhận diện bằng VIỆC RENDERER CỦA NÓ LÀM GÌ, không chỉ bằng con dấu
compose — và khoảng cách đó đã phải trả giá.** Tập bỏ qua trước đây dựng từ `isOverlay` —
"node này có mang `overlayId` và nằm trực tiếp dưới ROOT không" — đúng cho trap 1 và sai ở
đây: `cart-drawer` TỰ ẩn và tự dịch mình ra ngoài (`render/nodes/cart-drawer/css.go`), nên
một drawer viết thẳng vào tài liệu trang vẫn đỗ ngoài màn hình mà không có con dấu nào. ĐO
trên một storefront thật: mọi trang đều đúng như vậy, nên tập bỏ qua RỖNG và `sb_look` báo
MƯỜI BA finding off-canvas mỗi trang ở mọi khổ, trên những trang hoàn toàn đúng — đúng cái
"danh sách không ai đọc" mà chốt chặn này sinh ra để tránh. Với phép kiểm phía render, cùng
những trang đó báo MỘT finding: một overlap thật trong header dùng chung, trước đó bị vùi
dưới nhiễu. Cùng điểm mù đó khiến `sb_look node_id:<bất kỳ node nào trong drawer>` hỏng
thẳng: không có gì được mở, vùng clip rơi ra ngoài ảnh, và Playwright trả về "Clipped area is
either empty or outside the resulting image". `overlayRoot` trong `core/tree` cố tình KHÔNG
được nới theo — nó trả lời câu hỏi compose mà mọi write guard hỏi, và nới nó ra sẽ khiến
`refuseOverlay` bắt đầu từ chối những lệnh ghi lên một drawer mà trang thật sự sở hữu.

Ảnh chụp có CUỘN hết trang trước khi bấm máy, nên ảnh lazy dưới màn hình được tải thay vì
chụp thành ô trống. Đo trên storefront thật: bốn ảnh chưa tải trước khi cuộn, không còn cái
nào sau đó.

Cần **Google Chrome của hệ thống**: `playwright-core` không kèm trình duyệt nào nên lúc cài
không tải gì. Nếu thiếu Chrome, tool nói đích danh chứ không trả ảnh trắng — một agent đi
chấm bức trang nó chưa từng nhìn thấy còn tệ hơn một agent chịu dừng.
Chrome được mở ở lần look đầu tiên và giữ mở suốt vòng đời của process, còn các bề rộng được
chụp song song, mỗi bề rộng một tab — một lần look ba bề rộng mất khoảng một giây thay vì
ba. Ảnh trả về là JPEG chất lượng 80 trừ khi yêu cầu `format: "png"`; định dạng chỉ thay đổi
số byte và độ trễ, vì client tính giá ảnh theo kích thước pixel chứ không theo số byte.


**Bản xem trước CÓ luồng dữ liệu cửa hàng — cứ đánh giá trang danh sách từ nó.**
`ServePreview` chạy `RenderDraft` → `gather` → `assemble`, đúng đường của một trang đã
publish, và chú thích của chính nền tảng nói kết quả "byte-identical to what publishing this
source would serve" (`storefront.go:1260`). Trang chủ xem trước ra đúng sản phẩm thật với
giá thật.

Thứ bản xem trước không làm được là phân giải MỘT BẢN GHI từ địa chỉ: định tuyến entity nằm
ở `ServeHost` chứ không ở `ServePreview`, nên một **template entity** — trang chi tiết sản
phẩm hay danh mục — xem trước với không gì được bind. Tiêu đề trống, giá đọc ra 0, và bộ
chọn biến thể hiện các giá trị seed của element ("Color / Size", "Red / S") thay vì của
chính sản phẩm. Đó là bản xem trước, không phải trang. Truyền địa chỉ storefront ĐÃ PUBLISH
vào `url` để đánh giá một template; kết quả trả lại địa chỉ đó ở `shot`. `url` cũng là lối
thoát khi origin xem trước được đúc ra không truy cập được, đúng tình huống máy dev có
`STOREFRONT_BASE_DOMAIN` mà không có TLS.

Trang được chờ bằng `load` cộng một khoảng lắng có giới hạn, không bao giờ chỉ `networkidle`:
storefront giữ kết nối mở (island giỏ hàng poll, endpoint phiên khách trả 401 mãi), nên chờ
một khoảnh khắc yên tĩnh không bao giờ tới khiến đúng trang duy nhất có dữ liệu thật lại
không chụp được.

## `sb_event`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | string | |
| `action` | string | Một hành động element này cho phép, hoặc `"none"` để xoá |
| `trigger` | string? | Mặc định `click` |
| `payload` | object? | |
| `dry_run` | boolean? | Mặc định true |
| `force` | boolean? | Bỏ qua một guard mềm; thông điệp được trả về trong `forced[]` thay vì ném lỗi. Guard cứng bỏ qua tham số này — xem "Mỗi lần ghi kiểm tra gì" |

Cách duy nhất đặt được click action lên một node. `NodeSpec` không mang `events`, `sb_set`
chỉ ghi style / config / specials, còn `createNode` luôn ghi `events: []` — nên `open_cart`
hoàn toàn không tạo được, và một site dựng từ trắng không có cách nào mở giỏ hàng của chính
nó, trong khi `sb_review` vẫn báo thiếu kèm một cách sửa không gì thực hiện được.

Hành động được kiểm với allow-list của chính element, sai thì bị từ chối kèm danh sách. Danh
sách nào **đang sống** phụ thuộc vào node: một nút đã gắn binding mua hàng dùng
`bindingEvents` — nút thường thì điều hướng, nút đã bind thì bàn giao cho giỏ hoặc trang
thanh toán, và hai tập loại trừ nhau vì "thêm sản phẩm này rồi đi tới một URL bất kỳ" không
phải thứ cart runtime diễn đạt được.

**Mua hàng không phải sự kiện.** `add_to_cart` và `buy_now` không nằm trong allow-list của
element nào; meta của button nói thẳng lý do. Ý định nằm ở BINDING — `sb_bind` kèm `action` —
còn event là thứ xảy ra song song. Hỏi ở đây sẽ bị từ chối và chỉ sang `sb_bind`.

Một hành động cho một trigger, thay tại chỗ: hai `click` trên một node là hai câu trả lời cho
một câu hỏi.

**MỖI LẦN GHI ĐỀU MANG THEO PHÉP CHIẾU `<a href>`, vì `node.events` KHÔNG BAO GIỜ được
renderer đọc.** Một click điều hướng DUY NHẤT được render từ `specials.href` và không từ đâu
khác: `nodes.EventAttrs` bỏ qua nó thẳng thừng —

```go
if ev.Name == "click" && clicks == 1 && purchaseItem == "" &&
    (ev.Action == "go_to_url" || ev.Action == "open_page") {
    continue // dạng <a href>; xem ở trên
}
```

— dựa trên giả định đã nói rõ rằng href đã có sẵn, vì "một lời gọi đặt cạnh một anchor sẽ
điều hướng hai lần". Editor giữ đúng giả định đó bằng cách ghi event và href của nó trong
cùng một bước undo (`projectHref`); công cụ này thì không, nên `sb_event action:"go_to_url"`
tạo ra một node không có anchor lẫn `on:click`. Một control render đẹp, lưu được, publish
được, và **bấm vào không làm gì cả** — câm ở mọi bước, vì `sb_review` đọc cây và cây đúng,
còn `sb_look` chụp trang và trang trông đúng.

Đo trên một storefront thật: ba tấm ảnh ở trang chủ mang
`click: go_to_url {"url":"/bo-suu-tap"}` được publish thành thẻ `<img>` trần, ngay cạnh một
nút có href và publish thành `<a href="/bo-suu-tap">`.

Nên `href` và `target` giờ đi theo danh sách click, đúng luật của editor: chỉ chiếu cho một
click `go_to_url`/`open_page` DUY NHẤT trên node không có binding mua hàng, ngoài ra thì xoá.
`go_to_checkout` không bao giờ được chiếu — một bước sang thanh toán không phải link thường.
Một `open_page` mà payload không có `url` đã phân giải thì không chiếu gì, thay vì bịa ra một
cái, vì cả hai renderer đều không phân giải được page id. `sb_review` báo node tới đây bằng
đường khác là `dead_nav`.

---

## `sb_bind`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | string | |
| `source` | string | Một trong 77 khoá mà hai bộ render cung cấp — `product.title`, `product.price`, `category.title`, `course.title`, `site.*`, … Schema chỉ nêu bốn cái; sai một khoá thì bị từ chối kèm danh sách đầy đủ, nhờ vậy danh sách tool vẫn gọn |
| `field` | string | Luôn là `specials.<key>` |
| `dry_run` | boolean? | Mặc định true |
| `action` | `"add_to_cart"` \| `"buy_now"`? | Biến node thành nút MUA HÀNG thay vì một trường dữ liệu |
| `force` | boolean? | Bỏ qua một guard mềm; thông điệp được trả về trong `forced[]` thay vì ném lỗi. Guard cứng bỏ qua tham số này — xem "Mỗi lần ghi kiểm tra gì" |

Cả hai tham số đều được kiểm với từ vựng sinh tự động, vì cả hai lỗi đều **im lặng**:
`source` lạ sẽ giải ra rỗng và hiện placeholder của chính element (không phân biệt được với
"đang tải"), còn `field` ngoài `specials` thì được lưu, được ghi, được publish, và bị bỏ qua
mãi mãi — `applyBindings` đọc namespace từ field rồi bỏ qua mọi thứ khác.


## Binding mua hàng

`action` ghi cái binding mà thiếu nó thì cửa hàng không nhận được đơn nào. Nút mua hàng
không phải một binding thường và trước đây không tool nào tạo được: bộ render quyết định một
button *là gì* bằng cách đọc `target.action` và chỉ nó thôi
(`server/render/nodes/helpers.go:1166`), `sb_set` chỉ ghi style / config / specials, còn
nhánh thường của tool này không ghi `target` nào cả. Nên một cửa hàng dựng hoàn toàn bằng bộ
tool này không có nút "Thêm vào giỏ", trong khi `sb_review` vẫn báo thiếu hành động mua hàng
mà không nêu được cách sửa nào chạy được.

Truyền `product.id` làm `source` và `specials.boundProductId` làm `field` — đúng hình dạng
editor ghi. Binding mang id dành riêng `bind-product-action`, nên gọi lần hai sẽ trỏ lại
chính nút đó thay vì để hai binding mua hàng trên một nút. `buy_now` được lưu thành
`dynamic_checkout`, đó là từ vựng của tài liệu; chữ trong bộ chọn và chữ được lưu khác nhau
có chủ đích, và tự map tay là cách hai bên lệch nhau.

---

# Thiết kế như người thật

## `sb_traits_for` — inspector, không phải bản tóm tắt

Trả về inspector của element đúng như người ta nhìn — **tab → nhóm → tên control** — và,
với mỗi control nền tảng có khai báo, nó ghi vào đâu:

```
{ type, hints: { useWhen, avoidWhen, contentTips },
  inspector: [{ tab, groups: [{ group, controls: ["font_size", …] }] }],
  declared: { font_size: { label, writes, defaults? }, … },
  defaults, translatable?, config_values?, specials_values?, isContainer, isRootOnly,
  childAllows, undeclared_note, style_is_open_css }
```

`translatable` nêu special nào của element này được phép dịch, và special nào nó đang mang mà
TUYỆT ĐỐI không được dịch — dịch nhầm không làm trang xấu đi mà LÀM HỎNG render (`name` là id
icon lucide, `src` là URL, `filterSource` là id registry mà renderer switch theo). Danh sách
`specials` RỖNG là câu trả lời đầy đủ chứ không phải thiếu: chuỗi duy nhất của icon là một id
icon. Phần entity nằm trong call sheet của mọi operation `/translations`.

`sb_set` cũng cảnh báo khi một key FIELD-SKIN rơi vào form node không render nó — FORM khoác
bộ input vocabulary cho mọi field nó chứa, còn payment card, choice group, timeslot hay file
field mang bộ riêng, và knob đặt nhầm chỗ thì được lưu mà không ai đọc. Cảnh báo nêu luôn node
nào sẽ render key đó.

`config_values` nêu GIÁ TRỊ HỢP LỆ của vài config key mà đoán sai thì hỏng trong im lặng. Mọi
trait trong registry của nền tảng đều khai `schema: string`, nên từ vựng của control nằm trong
component Vue vẽ picker — agent không đọc được — và `EffectiveCollectionType` là NORMALISER chứ
không phải validator: chính test của nền tảng ghim `"bestseller"` → `all_products`, nên repeater
đặt một từ nghe hợp lý sẽ lặp cả catalogue dưới heading bạn viết, không lỗi ở bước nào. Sinh từ
Go nên mang theo cả giá trị mặc định khi không nhận ra và các alias (`category` là cách viết
chạy được của `collection`). Nó gắn vào ELEMENT chứ không vào control, vì đúng những key cần
nhất — `collectionType` trong đó — lại là những key KHÔNG được khai báo.

`specials_values` là câu trả lời tương tự cho namespace `specials`, tách riêng vì đó chính là
namespace bạn ghi vào. Mọi entry ở cả hai đều nêu `writeKey` của nó, và đọc phần đó là bắt buộc:
entry được đánh khoá theo CONTROL ở mọi chỗ picker của editor là nguồn, và tên control KHÔNG phải
là key của nó — `divider_orientation` ghi `config.orientation`, và mười một trên mười ba control
join được đều như vậy. Hai cờ nữa đáng biết: `open` nghĩa là renderer chuyển thẳng giá trị
không có trong danh sách (`mediaImageRatio` thực sự nhận nguyên văn `4 / 5`, nên danh sách là những
từ có Ý NGHĨA RIÊNG chứ không phải toàn bộ giá trị hợp lệ), và THIẾU `fallback` nghĩa là nguồn
không nói — picker của editor chứng minh tác giả được chọn gì, và im lặng về việc renderer làm gì
với một từ ngoài danh sách.

`sb_set` còn cảnh báo khi CHÍNH KHOÁ đó không được gì đọc. Các từ vựng ở trên trả lời "giá trị
này mang nghĩa khác điều bạn nghĩ"; cái này trả lời "không giá trị nào mang nghĩa gì". Element
gieo sẵn khoá, `sb_node_read` trả nó về kèm một giá trị hợp lý, và một lệnh ghi vào nó vẫn lưu,
vẫn save, vẫn publish và render y như cũ, không lỗi ở bước nào. Inspector không vẽ dòng nào cho
khoá như vậy, nên chỉ agent mới với tới được. Sinh ra bằng cách quét mọi định danh nền tảng phát
hành — 384 khoá được gieo đối chiếu 76.235 định danh trong 3.966 tệp, một khoá chết
(`config.splitDirection` trên `image-comparison`). Khoá CHỈ do editor đọc là đúng và không bao
giờ bị báo. Ghi chú nêu đúng chỗ gieo, vì chỗ sửa nằm ở thượng nguồn và không cách viết nào của
khoá chạy được.

**Gắn theo element, và đó không phải chi tiết vặt.** `config.layout` mang một bộ từ trên
`media-dataset` và một bộ khác trên `list-dataset`; `specials.source` được ghi bởi
`breadcrumb_source` (`auto|manual`) và bởi `qr_source` (`text|page`); ba renderer đọc
`config.placement` với ba tập case khác nhau. Một bảng chỉ đánh khoá theo write key sẽ đưa cho
element này từ vựng của element khác — đúng cái sai trong im lặng mà bảng này sinh ra để chặn.
Không gì được công bố nếu nguồn không CHỨNG MINH danh sách là đủ — một `switch` trong Go có nhánh
`default:` bắt hết phần còn lại, hoặc chính danh sách option của picker. Một phép so sánh bằng
không chứng minh được điều nào, nên những key đó vắng mặt thay vì trả lời nửa vời: danh sách thiếu
sẽ gọi một giá trị đang chạy là sai, và agent tin nó sẽ đi “sửa” một trang vốn đã đúng.

`hints` là chính AI hints của nền tảng cho element, đặt ở đây vì đây là lệnh agent gọi sau
khi đã chọn xong. `declared` chỉ chứa các control có đích ghi khai báo sẵn — 118 trên 435
control trong trait registry của nền tảng. Số còn lại trả về **chỉ có tên**, và
`undeclared_note` nêu lý do một lần: ràng buộc của chúng dựng bên trong widget Vue, máy không
đọc được. (Trước đây lặp lại dưới từng cái; riêng `list-dataset` đã 74 KB.) Với những cái
đó, hãy đọc một node đã dùng control ấy (`sb_node_read`), set thẳng thuộc tính CSS, hoặc
truyền `control` để đọc đầy đủ một control — chế độ đó không đổi.

**`style` là CSS mở.** Mọi khoá camelCase đều thành một thuộc tính CSS, nên bạn set được
bất cứ thứ gì CSS diễn đạt được, dù có control cho nó hay không. `config` và `specials`
thì **không** mở — chúng theo từng element, và `defaults` của element nói đúng những khoá
nó thật sự dùng.

## `sb_duplicate`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `force` | boolean? | Bỏ qua một guard mềm; thông điệp được trả về trong `forced[]` thay vì ném lỗi. Guard cứng bỏ qua tham số này — xem "Mỗi lần ghi kiểm tra gì" |

`id`. Nhân bản node và cả cây con dưới **id mới**, chèn ngay sau bản gốc — thao tác người
thiết kế làm liên tục. Style đi theo, và đó chính là mục đích. Từ chối ROOT, site overlay, và cây con có chứa
app block — bản sao sẽ mang dấu của block và lần lưu sẽ rút nó về tham chiếu kèm một cảnh
báo client này không hiển thị.

## `sb_templates` / `sb_template_use`

`sb_templates` liệt kê section template đã lưu dưới dạng
`{ sectionTemplates: [{ id, name, description, categoryIds, source, listed, updatedAt }], total }`
— các trường lệnh kế tiếp cần, không phải cả tài liệu của template. `sb_template_use` thả
một cái vào trang — server tự copy, nên section tới đúng như lúc được thiết kế. Nhớ mở lại
trang sau đó; phiên đang mở vẫn giữ cây cũ.

### Layout dựng sẵn

`sb_templates` liệt kê section template của chính site trước, rồi tới bộ layout DỰNG SẴN ở
`built_in`. Template do merchant thiết kế là câu trả lời của site này; những cái kia là mặc định
cho một trang chưa có gì — đo trên site thật, thư viện của nền tảng có **hai** mẫu, và đó là lý
do agent được yêu cầu "một hero" phải tự bịa từ flex-block mỗi lần.

`sb_template_use` nhận cả hai loại id. Template của site do **server** sao chép, nên section về
đúng như đã thiết kế. Layout dựng sẵn thì được **soạn tại chỗ**, theo token của chính trang đích
— cùng màu chữ tiêu đề, cùng nền nút, cùng padding section mà trang đang dùng. Trang chưa có gì
thì lấy theo **theme của site**, mang dạng `var(--wb-color-…)` chứ không phải mã màu: một giá trị
cứng trên node sẽ vĩnh viễn thắng style preset bên dưới, nên một band đóng đinh màu hôm nay sẽ
ngừng đi theo theme ngay khi theme đổi.

**Ô ảnh lấy ẢNH THẬT, từ thư viện của chính site.** `sb_template_use` đọc thư viện rồi đưa cho
mẫu những ảnh merchant đã có, ưu tiên ảnh ngang ở chỗ bố cục cần, và không lặp lại ảnh mà trang
đang hiển thị. Đây là nguồn trung thực duy nhất: ảnh stock theo từ khoá thì không phải (chính
lần dựng của repo này từng nhận về một bức tượng mèo cho "kids,clothing"), còn hộp xám thì đọc
ra là chưa làm xong — vì đúng là chưa xong. Site có thư viện rỗng sẽ nhận một câu chỉ tới
`sb_media_upload` thay vì một placeholder.

Các mẫu được dựng dưới dạng cây capture rồi đi qua đúng mapper mà một lần import đi qua, nên mỗi
mẫu tự thừa hưởng câu trả lời cho rule 0, 1 và 3 — token của trang, điểm gãy dọc trên mọi hàng,
và cột cao đúng bằng nội dung khi hàng xuống dọc.

**Bốn trong mười một mẫu mang hình dáng CỬA HÀNG**, đóng lại một lỗ hổng mà bảy mẫu đầu của repo
này để hở ở một tầng cao hơn: một store builder xuất bản layout hero/feature/stats/CTA/gallery/
FAQ mà không cái nào là một cửa hàng. `sb_product_shelf` và `sb_category_strip` là một repeater
`list-dataset` THẬT gắn vào danh mục — không phải ô tĩnh khoác ảnh sản phẩm, tức một cửa hàng mà
mọi giá là chữ cứng và không gì mua được. Cả hai chỉ khai `config.datasetSource` (và, ở nơi
element có trục kind, `config.kind`); `createNode` qua `bindingsForConfig` của nó tự suy ra mọi
binding tại lúc thêm, nên mẫu không thể trôi khỏi factory của platform theo cách một binding
chép tay đã từng trôi hai lần trong lịch sử repo này. `sb_brand_wall` là mẫu ô ảnh như
`sb_gallery` (logo thật từ thư viện, hoặc một câu chỉ tới `sb_media_upload`), nhưng khung bằng
`contain` chứ không phải khung tỷ lệ trung vị của một dải ảnh — một logo trong suốt bị ép vào
khung crop của ảnh chụp sẽ mất hình dạng của chính nó. `sb_trust_band` là icon-kèm-dòng-chữ (giao
hàng, bảo hành, đổi trả, thanh toán), gọi đúng id icon của platform chứ không đoán mò như bước dò
icon mờ của import phải làm.

Một band cửa hàng thứ năm — form đăng ký nhận tin — đã bị xét và loại. Element `form` trên trang
chỉ là một tham chiếu trơ tới một TÀI LIỆU FORM RIÊNG (`specials.formId`); dựng nó cho đúng nghĩa
là ba lần ghi có thứ tự mà `sb_store action:"form"` đã sở hữu (tạo → PUT lại toàn bộ → lưu tài
liệu field), không phải một `NodeSpec` mà một mẫu có thể soạn offline. Xuất bản một node `form`
không có `formId`, hay một ô nhập với nút bấm không gửi đi đâu, chính là loại element trông xong
mà chết mà bảng `INERT_ON_ADD` của repo này sinh ra để chặn.

## `sb_page_repair`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `site_id` | string? | Mặc định lấy `SB_SITE` |
| `page_id` | string? | Bỏ trống để kiểm tra mọi trang của site |
| `dry_run` | boolean? | Mặc định `true` — chỉ liệt kê những gì sẽ đổi |

**GỐC CỦA TRANG LÀ `ROOT`, VÀ CÁC BẢN CŨ CỦA SERVER NÀY KHÔNG GIỮ NÓ.** Seed từ
`sb_page_create` và `sb_store action:"checkout"` đã đổi tên gốc (`sppro_1`, `plabo_1`,
`rt_<hex>`). Storefront vẽ được cả hai; editor build trước web_builder `7322af49a` vẽ canvas
trắng và có thể autosave trang thành rỗng. Tool này đổi gốc về `ROOT` trong BẢN NHÁP — số
node và thứ tự con giữ nguyên. Trang đã publish được liệt kê ở `republish`; tab editor đang
mở trang vừa sửa (thấy qua live room) được nêu ở `editors_open`, vì tab mở trước lần sửa sẽ
ghi lại gốc cũ ở lần autosave kế tiếp.

Mọi lần ghi tài liệu trang giờ cũng tự đổi tên này trên đường ra, và `sb_page_open` báo gốc
tự sinh qua `minted_root`, nên tool này dành cho những trang không ai đang sửa.

## `sb_page_list` / `sb_page_create` / `sb_publish`

Vòng đời trang, thành tool hạng nhất thay vì đi vòng qua `sb_api_call`. `sb_page_list` trả
về `{ pages: [{ id, name, slug, path, isHomepage, type, status, updatedAt, publishedAt }], total }`
— khối settings của trang ở lại phía sau. Trang mới tạo thì rỗng, và `sb_page_open` gieo
ROOT cho nó.

Ba tool liệt kê đều chiếu theo whitelist. Tài liệu OpenAPI không mô tả phản hồi dạng danh
sách, nên tên trường được đọc từ json tag của các struct Go; một mục không phải object thì
trả về nguyên vẹn, nên nền tảng đổi hình dạng sẽ lùi về hành vi hôm qua chứ không thành một
danh sách rỗng.

**TRANG CỬA HÀNG SINH RA ĐÃ CÓ SẴN NỘI DUNG.** `product`, `category`, `search`, `blog`, `post`
và `complete` mở ra với đúng tài liệu mà editor đưa cho người bán — sinh bằng cách GỌI các card
của palette chứ không chép lại, nên hôm nào card thêm mảnh thì cả hai cửa cùng có. Trang product
mang nguyên buy box (gallery, tiêu đề, giá, chọn biến thể, mô tả, bộ tăng giảm số lượng, Thêm vào
giỏ, Mua ngay) đã bind sẵn, kèm BINDING `add_to_cart` — thứ khó đoán nhất. **Trang mới MANG CHROME CỦA SITE.** Trang tạo qua editor thì có sẵn header và footer của site;
trang tạo ở đây thì không có gì cả — nên agent dựng site sẽ ra những trang không menu, không
footer, trên một site có đủ cả hai, và không gì báo cả: `sb_review` đọc trang thì trang không
sai, còn `siteChrome` hỏi SITE có global không thì có. Header và footer được đọc từ **TRANG
CHỦ** chứ không chọn theo tên hay thứ tự: một site có thể giữ nhiều cái mỗi loại (store đo được
ở đây có bốn header), và trang chủ là câu trả lời của chính site cho câu hỏi cái nào là chrome.
Tham chiếu đặt ở đầu và cuối — đúng thứ tự dải mà mọi lần lưu đều bị kiểm. `chrome: false` để
tắt, và site không có trang chủ để đọc thì được để yên chứ không đoán.

Truyền `seed:false`
nếu muốn trang trắng. `locale` (mặc định `vi`, hoặc `en`) và `headline` chọn câu cảm ơn của trang
complete, đọc từ i18n của nền tảng để cửa hàng tiếng Việt không mở ra bằng tiếng Anh. Seed là lệnh
ghi THỨ HAI: nếu nó hỏng thì trang vẫn được tạo và đang trắng, kết quả nói rõ điều đó chứ không
làm hỏng cả lệnh tạo.

`sb_publish` **lan**: trang dùng chung global section với trang khác sẽ publish luôn các
trang đó, vì header sửa một lần không được lên live ở trang này mà cũ ở trang kia.

**Nó báo BẢN NÀO đã lên live** — `id` (dòng published), `publishedAt`, và `fromVersionId`
(bản nháp mà nó được biên dịch từ đó). Ba trường này trả lời đúng câu người gọi hỏi ngay sau
khi publish và trước đây không có cách nào hỏi; `document`, `html`, `css` của dòng đó vẫn bị
bỏ, vì publish lan và trả chúng về là đổ markup của mọi trang được publish lại vào người đọc.

**`verify: true` rồi tải trang live và nói origin đã phục vụ bản đó chưa.** Một mã 200 chứng
minh nền tảng đã lưu một dòng, không chứng minh một người xem đang được phục vụ nó:
storefront trả `cache-control: public, max-age=60`, nên hai thứ lệch nhau hợp lệ tới một
phút. Người publish rồi tải lại, thấy trang cũ, kết luận publish hỏng, rồi đi "sửa" thứ chưa
bao giờ hỏng. Phép kiểm tải chính địa chỉ của trang (lấy từ link preview của nó, nên tên
miền riêng vẫn đúng) kèm tham số phá cache và `Cache-Control: no-cache`, rồi hỏi markup được
phục vụ có mang các node id mà lần publish này đặt vào không — mọi element renderer vẽ đều
mang `id="<node id>"`, nên id của các band cấp cao nhất là dấu vân tay của tài liệu mà không
cần so từng byte. Nó trả về `serving`, các band `missing` nếu có, `etag`, và `max_age` — tức
bản sao của người khác còn có thể khác trong bao lâu. Một phép kiểm KHÔNG CHẠY ĐƯỢC được báo
tách khỏi một trang không phục vụ đúng: lúc đó publish đã thành công rồi.

## Dùng chung với các MCP server khác

Bộ tool này trả lời ba trong năm câu hỏi mà một site đặt ra. Hai câu còn lại cần một nguồn
thiết kế và một trình duyệt điều khiển được, và chọn nhầm server thì hoặc phải trả giá bằng
một lần khởi động trình duyệt ngay giữa vòng lặp sửa, hoặc mất cả tiếng để chứng minh thứ mà
một lệnh gọi đã trả lời xong.

| Server | Trả lời | Dùng khi |
| --- | --- | --- |
| **Figma MCP** | thiết kế NÓI gì — token, tên nó, các biến thể, giá trị hover | đưa token VÀO, trước section đầu tiên |
| **Google Stitch MCP** | một design system đã chốt — bảng màu, chữ, bo góc, nền sáng/tối | đưa token VÀO, khi không có file Figma |
| **`sb_look`** | trang trông thế nào lúc này, ba khổ màn hình, ~900ms khi đã ấm | sau mỗi lần sửa. Đây là vòng lặp |
| **Chrome DevTools MCP** | TẠI SAO nó trông như vậy — computed style, stylesheet liên kết, console, network, Lighthouse | cây đúng mà trang sai |
| **Playwright MCP** | chuyện gì xảy ra khi có người DÙNG nó — click, cuộn, điền, gửi | thứ ảnh chụp không thể cho thấy nếu không được bảo trước |

**token vào → dựng → nhìn → chẩn đoán → chứng minh.** Đừng đặt browser server vào trong vòng
lặp sửa: `sb_look` chỉ ~900ms khi ấm vì nó gộp trình duyệt dùng chung suốt vòng đời tiến
trình, còn DevTools và Playwright thì gắn hoặc khởi động theo phiên.

Sáu câu hỏi chỉ browser server mới trả lời được, tất cả đều có thật trên nền tảng này:

1. **Header sticky có dính thật không?** Ảnh chụp là MỘT vị trí cuộn. Mở trang đã publish,
   cuộn, rồi đọc `classList` xem có `wb-stuck` — class do chính island của nền tảng bật, và là
   toàn bộ giao kèo phía sau trạng thái `stuck`. Nếu nó không bao giờ xuất hiện thì mọi
   override stuck trên trang đều được lưu và không bao giờ vẽ. `sb_look` nói điều này một lần,
   ở `stuck_note`, trên bất kỳ trang nào có ghim.
2. **"Style không ăn."** Hầu như lúc nào nó cũng ăn: CSS của trang là stylesheet LIÊN KẾT
   (`static-*.css`, `desktop-*.css`), nên grep HTML không chứng minh được gì. Hãy hỏi trình
   duyệt nó tính ra cái gì — `getComputedStyle(el)` — đừng hỏi markup nó viết gì.
3. **Cart drawer có mở khi khách bấm không?** `sb_look` chụp nó bằng cách tự thêm class
   `is-open` của nền tảng, nên không nói gì về cái nút. Hãy bấm đúng control thật; một drawer
   không bấm mở được là một cửa hàng không ai mua được.
4. **Checkout có nhận đơn không?** `sb_store` dựng nó và `sb_review` báo các lỗ hổng; không
   cái nào gửi đơn cả. Hãy điền form và kiểm tra khách có đến `/checkout/complete` — trên cổng
   **sandbox**, tuyệt đối không dùng credential thật.
5. **Trang mẫu thực thể trông thế nào với bản ghi thật?** Định tuyến thực thể nằm ở
   `ServeHost` chứ không phải `ServePreview`, nên MẪU sản phẩm hay danh mục xem trước với
   không gì được bind. Dùng `/products/{slug}` đã publish.
6. **Nó có nhanh và có đứng yên không?** Lighthouse trên storefront đã publish. CLS mới là thứ
   đáng quan tâm ở đây — renderer ghi `width`/`height` nội tại lên mọi `<img>` chính là để giữ
   nó bằng 0, nên một khung có `aspect-ratio` đánh nhau với hai thuộc tính đó sẽ lộ ra dưới
   dạng dịch chuyển bố cục chứ không lộ trong ảnh tĩnh.

Hai điều không nên làm: chạy DevTools MCP và Playwright MCP cùng lúc trên cùng một trang
(chúng là hai trình duyệt, không phải hai góc nhìn của một), và trỏ một trong hai vào bản xem
trước nháp khi câu hỏi là về dữ liệu hay định tuyến. Hãy kiểm tra từng server có được expose
trong PHIÊN NÀY trước khi lên kế hoạch quanh nó — một MCP server có thể được cấu hình theo
phạm vi dự án, và Figma chưa xác thực chỉ lộ ra `authenticate`.

---

## Hover và các trạng thái khác

`sb_set` nhận `state` — `hover` là cái inspector có. Một trạng thái có **hai chỗ ở**, và
platform gọi tên cả hai (`schema/src/node.ts`, được `MergeStateNs` trong
`render/style/cascade.go` phản chiếu):

| Cách gọi | Ghi vào | Dùng khi |
| --- | --- | --- |
| `state:"hover"` + `breakpoint:"mobile"` | `responsive.mobile.states.hover.style` | trạng thái khác nhau theo khổ màn hình |
| `state:"hover"` + `base:true` | `states.hover.style` | trường hợp thường gặp — trạng thái không đổi theo khổ |

Base không phải trường hợp suy biến cần né: đó chính là nơi mỗi element gieo
`meta.defaults.states` của nó (hover của `tab-item`, của `quantity-button`), và
`MergeStateNs` đọc nó trước rồi để các slot breakpoint phủ lên, y hệt cách nó xử lý namespace
thường.

`specials` không nhận state và **báo lỗi** thay vì lặng lẽ bỏ qua — nội dung và định danh
không đổi theo hover.

---


### Hover có HAI nhà, và `states.hover` không phải lúc nào cũng là nhà đúng

Nền tảng thêm trạng thái hover phổ quát bên cạnh trạng thái ghim, và cách hiểu hiển nhiên —
"giờ hover là `states.hover`" — **sai với mười hai loại element** tự khai Hover variant: bộ biên
dịch phổ quát cố ý đứng sang một bên với tất cả chúng. `sb_set` ghi mỗi cái vào đúng nhà mà meta
của nó chỉ định, và báo lại khi nhà đó không phải state slot.

| Cách gọi | Rơi vào | Render thành |
| --- | --- | --- |
| `state:"hover"` trên hầu hết element | `states.hover` | `@media (hover:hover){#self:hover{…}}` |
| `state:"hover"` trên `button` | `config.stateHover` — phẳng, **chỉ base** | luật `:hover` của chính button |
| `state:"hover"` trên filter, `text-dataset`, hay satellite (`tab-item`, `quantity-button`…) | `states.hover` | skin của chính nó, hoặc của CHỦ nó |
| `state:"parentHover"` — phổ quát trên mọi element | `states.parentHover` | `@media (hover:hover){#parent:hover #self{…}}` |

**Hiệu ứng thẻ mà mọi storefront đều có** là hàng 1 và hàng 4 hợp lại: rê chuột lên thẻ thì ảnh
phóng nhẹ và nút mua nhanh hiện ra.

```
sb_set ds_card style base:true state:"hover"       { boxShadow: "0 8px 24px #0002", transform: "translateY(-3px)" }
sb_set img_1   style base:true state:"parentHover" { transform: "scale(1.05)" }
sb_set btn_add config                              { revealOnHover: true }
sb_set btn_add style base:true state:"hover"       { backgroundColor: "<accent đậm hơn>" }   # → config.stateHover
```

**`parentHover` bám vào một HỘP TỔ TIÊN — mặc định là hộp gần nhất, và `sb_set` nói cho bạn biết
là hộp nào.** `specials.hoverHostDepth` (chỉ base, đếm từ 1, gần nhất trước) chọn hộp rộng hơn:
ngay khi ai đó gom vài thứ vào trong thẻ, hộp gần nhất trở thành cái nhóm đó và "rê lên cả thẻ"
cần depth 2. Depth vượt quá chuỗi thì **kẹp** về hộp ngoài cùng chứ không chết, và kết quả có
nói khi nó kẹp. Ba trường hợp cấu trúc khiến nó không có gì để bám —
`sb_set` từ chối và gọi tên từng cái thay vì lưu một luật không bao giờ khớp: SATELLITE (treo ở
config của chủ, không render element nào để đặt tên), con trực tiếp của ROOT (con trỏ luôn nằm
trong trang khi nó nằm trong cửa sổ), và node mồ côi.

**`config.revealOnHover`** ẩn element cho tới khi hộp bao quanh được rê chuột — biên dịch thành
opacity + visibility + pointer-events, không dùng `display`, nên transition được và không làm
thẻ đổi kích thước ngay dưới con trỏ. Nó cần đúng host đó và bị từ chối nếu không có: nền tảng
không sinh nửa nào, element sẽ cứ hiện.

**Mọi luật hover nằm trong `@media (hover:hover)`.** Trên màn cảm ứng `:hover` bị "dính", nên
thiết bị không con trỏ không khớp nửa nào của reveal và element đơn giản là luôn hiện. Đừng giấu
thứ khách bắt buộc phải chạm tới sau hover.

`hidden: true` là config key duy nhất một trạng thái hover dịch được (thành `display: none`), và
chỉ nhận `true` — cùng giao kèo với trạng thái stuck.

Một element đang hỏng ở phía nền tảng: `product-image-list` khai `storage: 'node'`, tức hover của
nó thuộc về `states.hover`, và đo ngày 2026-09-09 thì **không gì compile nó cả**. `sb_set` vẫn ghi
đúng chỗ meta chỉ định và kèm cảnh báo.

---
### Ghim (pin) và trạng thái `stuck`

`position: sticky` không tạo ra thay đổi nào mà CSS quan sát được khi nó bám — không có
`:stuck` — nên platform bật một class (`wb-stuck`) lên chính phần tử được ghim từ một runtime
island, rồi biên dịch mọi rule viết cho dáng-lúc-ghim theo class đó. Vì vậy `stuck` là **trạng
thái duy nhất có điều kiện tiên quyết**, kèm ba kiểu hỏng lặng lẽ:

| Bạn viết | Nếu không có guard |
| --- | --- |
| `state:"stuck"` trên node không có gì được ghim | Renderer không sinh rule nào (`render/css.go` chỉ sinh CSS stuck khi có stuck host). Được lưu, được save, được publish, và không bao giờ vẽ. `sb_set` từ chối và chỉ đúng node cần ghim |
| Chỉ `position: "sticky"` | Chạy nửa vời. Platform đo trong Chromium: một section đã ghim mà không có `z-index` sẽ bị bất kỳ phần tử `position: relative` ở section sau vẽ ĐÈ lên ngay khi cuộn qua. `sb_set` gieo kèm `top: 0px` và `zIndex: 10`, đúng như inspector làm, và không bao giờ ghi đè giá trị bạn đã đưa |
| Node sticky nằm dưới một ancestor cắt tràn | Sticky bám theo ancestor **cuộn được** gần nhất, nên `overflow: hidden\|auto\|scroll\|clip\|overlay` ở trên nó trở thành ancestor đó, và node ghim bên trong một hộp không bao giờ cuộn. `sb_set` cảnh báo và gọi tên ancestor — kể cả ở dry run — còn `sb_review` báo `sticky_blocked` |

Node **con** tự tạo dáng thông qua host: rule biên dịch thành `#host.wb-stuck #self`, nên một
header đã ghim có thể thu nhỏ logo và ẩn tagline mà cả hai đứa con không cần biết ai ghim.
Ghim section trước, rồi viết `stuck` lên các con.

```
sb_set hd_1 style base:true { position: "sticky" }      # gieo kèm top:0px, zIndex:10
sb_set hd_1 style base:true state:"stuck" { boxShadow: "0 2px 8px #0002" }
sb_set logo style base:true state:"stuck" { height: "24px" }
sb_set tag  config      state:"stuck" { hidden: true }   # config key DUY NHẤT một state dịch được
```

`hidden` là config key duy nhất trạng thái stuck biến thành khai báo (`display: none`), và chỉ
nhận `true`: `false` sẽ cần `display: revert`, thứ trượt qua cả CSS tĩnh của chính element về
mặc định của trình duyệt. Muốn thôi ẩn thì xoá override đi. `fixed` cũng được tính là ghim —
"khoảnh khắc trang đã cuộn qua chỗ đáng lẽ nó nằm" là cùng một ý đồ thiết kế — nhưng không
được gieo kèm, vì nó đến như một quyết định đặt chỗ có chủ ý. `config.stuckAfter` (px cuộn
trang, theo breakpoint) ghi đè thời điểm island coi là đã ghim — đây là thứ gần nhất với
"cuộn qua N pixel thì đổi style", và `sb_set` từ chối nếu đặt lên node không ghim được, cũng
như từ chối giá trị không có vị trí cuộn nào thoả, vì renderer không sinh ngưỡng cho cả hai
trường hợp và lặng lẽ quay về đáp án tự động.

---

# Cài đặt (`sbuilder-mcp install`)

```bash
npx -y sbuilder-mcp install --token wbk_… --api https://your-host
```

Ghi server này vào mọi agent client trên máy — Claude Code, Claude Desktop, Cursor,
Windsurf, VS Code, Codex. `--client cursor,codex` để chỉ định; `--dry-run` để diễn thử.

| Hành vi | Vì sao |
| --- | --- |
| **Gộp** vào file đã có | Những file đó chứa server của người khác. Ghi đè cả file là khác biệt giữa cài thêm một server và xoá sạch thiết lập của ai đó — mà họ chỉ phát hiện ở lần kế tiếp với tay tới một công cụ đã lặng lẽ biến mất. |
| Chép thứ nó thay thế sang `<file>.sbuilder-backup` | Đường hoàn tác, nêu rõ trong output. Một công cụ sửa config mà không nói file cũ đi đâu thì để lại cho bạn không gì để bấu víu. |
| **Từ chối** file nó không đọc được | Một config thừa dấu phẩy khả dĩ hơn nhiều một config đáng vứt, và nó chính là thứ bạn cần để sửa. |
| Idempotent | Chạy lại y hệt thì không ghi gì và không để lại backup thừa. |
| Một client hỏng không chặn các client khác | Cursor lỗi config không phải lý do để Claude Code không được cài. Báo cáo nói rõ cái nào ra cái nào. |
| Chỉ ghi **khoá** khi bạn có khoá | Khoá mở được mọi thứ agent làm hằng ngày. Nhét mật khẩu tài khoản vào sáu file config để đổi lấy vài lệnh cấp tài khoản là một đánh đổi tồi để quyết thay người khác. |

## `sb_review` — thứ một người xem sẽ thấy

Khác với chuyện trang có lưu được hay không: một tài liệu lưu được hoàn hảo vẫn có thể
publish ra một cái hộp rỗng. Trả về `{ findings, fixes, findings_notice? }`, theo thứ tự
tài liệu:

| Mã | Khiếm khuyết |
| --- | --- |
| `empty_page` | Không có gì — publish ra trang trắng |
| `missing_node` | Một node cha gọi tên đứa con tài liệu không có. Renderer đi vào một lỗ trống, và nền tảng từ chối mọi lần lưu cho tới khi nó biến mất — báo ở đây chứ không ném lỗi, vì một lần review chạy trên tài liệu đã hỏng, và đó đúng là lúc người gọi cần nó nhất |
| `dead_nav` | Một click điều hướng duy nhất mà không có `specials.href`. Renderer KHÔNG BAO GIỜ đọc `node.events`: `EventAttrs` không phát `on:click` cho nó, vì cho rằng href đã biến nó thành anchor. Nên control đó render, publish, và bấm vào không làm gì |
| `empty_container` | Section không chứa gì — một dải trống |
| `placeholder_content` | Vẫn là chữ mặc định của element ("Enter your text here") |
| `empty_text` / `missing_media` | Element bỏ trống — khoảng trắng, hoặc ảnh vỡ |
| `static_in_dataset` | Một element nằm trong repeater nhưng chỉ render nội dung do tài liệu ghi — cùng một tấm ảnh trên mọi thẻ sản phẩm |
| `unbound_dataset_element` | Element dataset không có binding nào — nó chờ một `bound…` special mà không ai ghi |
| `dead_binding_source` | Nguồn renderer không cung cấp — hiện placeholder mãi mãi |
| `dead_binding_field` | Field binding ngoài `specials` — được lưu, được publish, và bị bỏ qua |
| `unknown_element` | Type catalog không biết; chạy `npm run codegen` |
| `unlinked_form` | `form` không trỏ tới form nào — compose ra rỗng và publish thành MỘT HỘP TRỐNG. Platform cố tình im lặng về lỗi này |
| `default_seed_copy` | Một satellite được gieo sẵn vẫn mang nguyên chữ tiếng Anh của PLATFORM — empty state của repeater ghi "No products yet" bằng ink `#171717`. Chỉ hiện khi danh sách rỗng, nên không ai viết lại |
| `form_fields_flush` | `form` / `form-segment` / `form-step-nav` xếp các field mà không có `gap`, khiến mỗi label đọc như thuộc về ô phía TRÊN nó. Khác với `config.fieldStackGap` — khoảng cách label↔control nhỏ hơn, nằm BÊN TRONG một field |
| `dead_menu_link` | Mục menu không có `href` — renderer đọc `specials.menuItems` chứ không bao giờ đọc `menuId` |
| `extra_repeater_child` | Repeater chứa nhiều hơn một child mà nó nhân bản cho mỗi bản ghi; phần còn lại không bao giờ xuất hiện |
| `sticky_blocked` | Node đã ghim nằm dưới một ancestor cắt tràn. Sticky bám theo ancestor CUỘN ĐƯỢC gần nhất, nên ancestor đó trở thành chỗ bám và node ghim trong một hộp không bao giờ cuộn. Nó không nhúc nhích, và không gì báo cả. `key` chỉ ancestor cần sửa, không phải node |
| `order_goes_nowhere` | Trang vừa cộng tổng giỏ vừa có form, mà không có gì trên `form:success` đưa khách đi đâu. Đơn được tạo còn trang đứng yên, mọi dòng tổng giờ là 0 vì giỏ vừa bị dọn — một đơn thành công trông y như đơn hỏng. `afterSubmit: "redirect"` của form record KHÔNG sửa được: API lưu nó và platform không mang đi đâu cả |
| `hover_dead` | Hover được lưu ở `states.hover` trên element giữ hover ở chỗ khác — `button` giữ nó trong map phẳng `config.stateHover` mà renderer của chính nó compile. Được lưu, được publish, không ai vẽ. Mọi site server này dựng trước khi biết khác biệt đó đều dính |
| `stuck_no_host` | Override `stuck` trên node không có gì được ghim ở trên. `render/css.go` chỉ sinh CSS stuck khi có stuck host, nên phần tạo dáng được lưu, save, publish và không bao giờ vẽ. Thường do host bị bỏ ghim về sau, hoặc do import |

Ba mã cuối là những luật RENDER mà một document hoàn toàn hợp lệ vẫn có thể vi
phạm. `form` seed sẵn `formId: ""` và form chỉ được compose trên đường RENDER, nên
một form chưa liên kết trông y hệt trên canvas và là kết quả MẶC ĐỊNH của `sb_add`;
`menu` seed sẵn một mục có `href` là `""`, nên menu vừa thêm publish ra một nav
không dẫn đi đâu; còn `list-dataset` chỉ nhân bản `Data.Nodes[0]`. `sb_add` và
`sb_move` giờ TỪ CHỐI thêm child thứ hai vào repeater (sắp xếp lại bên trong vẫn
được), nên `extra_repeater_child` chỉ xuất hiện với document không do server này
viết ra. Danh sách phần tử chỉ-render-child-đầu được sinh ra từ chính các renderer,
vì `dataset-block` cũng là dataset container nhưng render TẤT CẢ child của nó.

Hai mã dataset này tồn tại vì lời khuyên thông thường lại sai bên trong một repeater. Một
`image` trong thẻ sản phẩm render `specials.src`, nên đặt giá trị cho nó là đặt MỘT tấm ảnh
cho mọi thẻ và ảnh riêng của sản phẩm không bao giờ hiện ra; cách sửa là đổi element —
`collection-media`, `text-dataset`, `pricing-dataset`… — danh sách đọc thẳng từ các bộ render
Go lúc codegen, gồm những element mà renderer có đọc một `bound…` special. Một element đã
được bind mà giá trị tự ghi để trống là đã xong, không phải còn dở, nên không bị báo.

Mỗi finding là `{ code, nodeId, type, problem, key? }` — có `key` khi lệnh sửa nêu một khoá
specials. **`fixes` là một chú giải**: mỗi mã có mặt một mẫu, với `<id>` và `<key>` để thay
vào, nên hai mươi placeholder tốn một câu thay vì hai mươi bản sao chỉ khác id (đo được ~270
ký tự mỗi finding). `findings_notice` là directive nói rõ đây là khiếm khuyết chứ không phải
gợi ý — repo anh em `webcake-landing-mcp` ghi trong chính source của nó rằng nếu thiếu, model
đọc cảnh báo như tiếng ồn tư vấn rồi lưu luôn. Nó đi kèm kết quả không rỗng đầu tiên trong
một process và vắng mặt sau đó. Review sạch là `{ findings: [], verdict }`.

Findings cũng đi kèm `sb_page_open` và `sb_look` đúng hình dạng này. Overlay và phần bên
trong app block được bỏ qua: placeholder ở đó không phải việc của trang này.

`node_id` đóng khung đúng một element — người thiết kế không chấm một thẻ bằng cách nhìn cả
trang, và ảnh full-page của một storefront dài làm cái thẻ đó chỉ còn vài pixel. Vùng cắt lấy
từ chính lần đo ra bounding box, nên thứ được đóng khung đúng là thứ `sb_set` nhắm tới. Node
không có trên trang đã render, hoặc render ra kích thước bằng 0, bị **từ chối đích danh** chứ
không trả về một bức ảnh sai.


**Và những gì chắn giữa cửa hàng này với một đơn đã thanh toán**, ở `store_gaps`, kèm
`store_notice` chỉ nói một lần mỗi process. Đây là luật kiểm tra sẵn sàng của chính nền tảng,
và chúng chỉ tồn tại trong editor (`editor/src/editor/storeReadiness.ts`) — không API nào lộ
ra, nên một agent không bao giờ mở editor thì mù hoàn toàn. Một storefront bốn trang dựng
hoàn toàn bằng bộ tool này review sạch, publish và render đúng; bảng publish của editor sau
đó liệt kê năm khoảng trống.

| `id` | Nghĩa là gì |
| --- | --- |
| `checkoutPage` | Chưa có trang `checkout` ĐÃ PUBLISH. /checkout định tuyến theo type, nên nút Thanh toán trong giỏ báo 404 |
| `payment` | Chưa có cổng thanh toán sống — chỉ còn thanh toán khi nhận hàng, đơn online tắc |
| `productPage` | Chưa publish trang `product`, nên mọi liên kết từ thẻ sản phẩm đều 404 |
| `shipping` | Không có phương thức giao: ô chọn ở trang thanh toán trống và mọi đơn miễn phí ship |
| `cartTrigger` | Không gì mở được giỏ; khách đóng ngăn giỏ rồi không quay lại được |
| `siteChrome` | Từ hai trang trở lên mà KHÔNG có global section nào, nên mỗi trang tự mang header/footer riêng. Đổi menu là sửa từng trang, các bản sao lệch dần, và khách gặp một site hơi khác ở mỗi lần bấm. Hỏi cho mọi site chứ không riêng cửa hàng — đây là câu hỏi duy nhất ở đây không liên quan tới tiền |
| `cartCount` | Có thứ mở được giỏ nhưng không có gì cho thấy trong giỏ có gì. `cart-count` là tuỳ chọn vì `open_cart` là một HÀNH ĐỘNG mà element nào cũng mang được, nên site dựng bằng bộ công cụ này không bao giờ tự có: khách thêm hàng, thấy một toast tắt đi, rồi không còn dấu hiệu nào cho thấy giỏ không rỗng |
| `categoryScope` | Từ hai danh mục sản phẩm trở lên mà không cái nào trỏ tới trang riêng, nên `/collections/{slug}` phục vụ chung một default template — và không gì trên đó thu hẹp feed sản phẩm theo danh mục trong URL. Khách bấm một danh mục thấy toàn bộ catalogue. Danh mục blog tự thu hẹp theo slug, cái này thì không |

Mỗi khoảng trống mang `draft: true` khi trang ĐÃ CÓ nhưng chưa publish, vì "publish cái đã
làm" và "tạo mới" là hai việc khác nhau. Sắp theo mức chặn giảm dần.

Bốn lệnh GET phụ trả giá cho việc này (pages, payment-gateways, shipping-methods,
global-sections) và không cái nào làm hỏng được review: một lệnh thất bại thì luật đó **im
lặng** thay vì báo một khoảng trống cửa hàng có thể không có. Một cảnh báo nổ trên cửa hàng
đúng là cảnh báo người ta học cách bỏ qua.

## `sb_media_list` / `sb_media_upload`

**Nó còn TÌM được ảnh.** `query` trả về ảnh chụp thật, mỗi tấm kèm mô tả do chính người chụp
viết — "Cute child wearing a black t-shirt and hat standing near a doorway" — và `pick: <id>`
upload đúng tấm bạn chọn vào thư viện của site. Nó không bao giờ upload một kết quả chưa ai đọc:
rule 7 ghi lại chuyện một từ khoá dán vào URL trả về cái gì (`loremflickr` đáp "kids,clothing"
bằng một bức tượng mèo), và lỗi chưa bao giờ nằm ở ảnh stock mà ở chỗ không ai nhìn.
`orientation` hỏi thẳng bộ tìm kiếm về HÌNH DẠNG, rẻ hơn nhiều so với cắt lại sau.

**`pick` còn nhận NHIỀU — `pick: [8633662, 35993723, …]` — và đó là cách một site vừa được server
này dựng lên có ảnh.** Site mới có thư viện rỗng, nên mọi ô ảnh trong mọi layout pattern chỉ là
một câu chữ cho tới khi có người lấp; một lần tìm trả về tám tấm còn `sb_gallery` muốn sáu, mà
mỗi lần chỉ chọn được một thì lấp một dải mất mười hai lượt gọi. Nhận nhiều không làm yếu rule 7:
điều rule đó bảo vệ là **có người đã nhìn**, mà đọc tám mô tả rồi chọn sáu cũng là cùng một hành
vi chọn như đọc tám rồi chọn một. Không truyền `pick` thì vẫn không upload gì cả.

Nó **không nguyên tử và không giả vờ là thế** — mỗi tấm là một lần upload riêng, nên kết quả trả
về `uploaded` và, khi có trục trặc, `failed` kèm pick cùng lý do. Một *pick* thiếu thì khác, và bị
từ chối trọn gói: nêu một id mà lần tìm không trả về thì không upload gì hết, vì giao nửa bộ là để
người gọi tự đoán còn ô nào lấp được. Chọn một tấm thì câu trả lời vẫn y như cũ.

**Key nhà cung cấp là của NỀN TẢNG, không phải của server này.** Tìm kiếm đi qua
`GET /api/sites/{siteId}/images/search` — một pool key Pexels xoay vòng nằm sau đúng credential mà
server này đang cầm — nên không có secret thứ hai trong mọi bản cài, không chia quota với sản phẩm
khác, và operator chỉ phải thêm key ở một chỗ (`PEXELS_API_KEYS` trên server). Chọn Pexels vì giấy
phép cho dùng thương mại tự do, ghi công là "được hoan nghênh" chứ không bắt buộc, nên storefront
mang ảnh mà không phải in dòng credit chẳng ai đặt hàng; tên người chụp vẫn được trả về.

Operator bật nó bằng cách thêm khoá ở khu Cài đặt của admin (**Khoá Pexels**) hoặc đặt
`PEXELS_API_KEYS` trên server. Nhiều khoá được xoay vòng — nhà cung cấp này tính giới hạn theo
từng khoá, nên mỗi khoá thêm vào là thêm một phần hạn mức — và khoá bị từ chối sẽ nghỉ 5 phút rồi
quay lại.

**Nền tảng không tìm được thì client này cũng không tự tìm.** Cố ý không có nhà cung cấp dự phòng:
có nó là đem đúng cái key mà nền tảng sinh ra để giữ, nhét ngược lại vào mọi bản cài. Thay vào đó
là một chỉ dẫn — tự tìm ảnh bằng cách của bạn rồi đưa URL, nền tảng sẽ tải về đúng như nó vẫn làm.

`sb_media_upload` là cách **duy nhất** để thêm ảnh. Endpoint nhận multipart
(`file:formData/file`), còn `sb_api_call` mã hoá mọi body bằng JSON — nên đi đường đó là gửi
JSON vào một handler multipart và nhận một lỗi không làm gì được. Một trang không có ảnh thì
chưa phải trang được thiết kế, nên đây chính là khoảng cách giữa *dàn xong bố cục* và *làm
xong trang*.

Nhận `path` (file trên máy) hoặc `url` (tải về rồi upload). Trả về asset kèm URL và đúng lệnh
`sb_set` để gắn nó lên node. Nên gọi `sb_media_list` trước — dùng lại ảnh cửa hàng đã có thay
vì thêm bản sao.

Lỗi nói rõ phía nào hỏng: `url` không tải được là `source_unreachable`, không đổ cho upload.

### Lỗi bố cục, đo trên bản render

`sb_look` còn báo những thứ chỉ tồn tại sau khi trình duyệt đã dàn trang — thứ đọc tài liệu
không tìm ra:

| Mã | Đo được |
| --- | --- |
| `off_canvas` | Nội dung tràn khỏi khung nhìn; trên điện thoại còn kéo theo thanh cuộn ngang cả trang |
| `text_too_small` | Chữ render dưới 12px, chỉ tính nơi thật sự có chữ |
| `overlap` | Hai element đè lên nhau — lồng nhau và sai số 1px không tính |

Mỗi lỗi kèm **các bề rộng** nó xảy ra, vì đó là phần lớn chẩn đoán: ổn ở 1440 mà hỏng ở 390
là lỗi responsive, không phải element hỏng. Chúng tới dưới `layout`, với `layout_fixes` là
chú giải và `layout_notice` — đo trên bản render chứ không đọc từ tài liệu; sửa ở đúng
breakpoint được nêu — lần đầu trong một process. Cả ba đều vắng mặt khi không đo được gì,
hoặc khi `node_id` đóng khung một element.

Nó không chấm thẩm mỹ. Một hero có đọc xuôi hay không thì không đo được, và giả vờ đo được
sẽ tiêu tốn sự chú ý của agent vào thứ nó không thể biết.

## `sb_import`

Đọc một trang từ URL công khai bất kỳ rồi thêm cấu trúc và nội dung của nó vào **trang đang
mở**, dưới dạng element thật mang token của **chính trang này**.

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `url` | string | Trang cần đọc |
| `site_id` | string? | Không truyền thì lấy `SB_SITE` |
| `max_sections` | number? | Mặc định 24 |
| `max_images` | number? | Mặc định 24 — mỗi ảnh là một lần upload |
| `max_nodes` | number? | Không có trần theo mặc định — chặn toàn bộ lần import nếu truyền |
| `upload_images` | boolean? | Chép ảnh vào media library của site, mặc định **true** |
| `dry_run` | boolean? | Mặc định **true** — trả về những gì tìm thấy |

**Không còn trần số node theo mặc định.** Các trần cũ — 300 ở đây, 400 trong chính `capture()`
— đang cắt bớt một trang dày đặc bình thường, không phải chặn một trang bất thường: một trang
chủ shop 2.400 sản phẩm đo được **19% coverage khi có trần, 100% khi không**, với 2.095 node
được lấy (2.680 spec dựng ra, ~420 KB, 2.4 giây). Việc duyệt đi qua một DOM hữu hạn, nên không
có trần cũng không thể chạy mãi không dừng; ai muốn có trần thì vẫn truyền `max_nodes` — không
truyền là cách duy nhất để nói "không trần". **Nhưng nhiều node hơn không đơn giản là tốt hơn.**
Một lưới sản phẩm của shop đến dưới dạng hàng trăm ô tĩnh là nội dung không thể bán được gì — không
giá, không tồn kho, không gắn gì vào catalogue cả — và nó thuộc về một repeater gắn vào catalogue
(`list-dataset` / `dataset-block`), không phải các node chữ cứng. Hãy xem lại một lần import dày
đặc trước khi publish; đó giờ là việc của người gọi, không phải của một cái trần.

**Bố cục được giữ ở chỗ trang nguồn thật sự có khai báo.** Một container thật sự dàn con của
nó — `display:flex` hoặc `grid` — với từ hai con trở lên sẽ thành một hàng thật, và hàng đó
mang sẵn **điểm gãy dọc ở mobile**, vì không có gì bắt hộ bạn một cột quá hẹp: các cột co lại,
không hộp nào tràn, `measure` im lặng trong khi tấm ảnh mỏng như sợi chỉ. Một `<div>` chỉ để
bọc thì bị làm phẳng, vì nó không phải một quyết định thiết kế. Một hàng bị chặn ở **12 cột** —
quá con số đó thì container ấy là cột nội dung của chính trang, và trình duyệt đang xuống dòng
chứ không phải xếp cạnh nhau — còn CSS grid thì luôn về ở chế độ xuống dòng, vì `flexWrap` đọc
ra `nowrap` trên grid chỉ vì thuộc tính đó không áp dụng.

**Header và footer của trang nguồn không bao giờ được mang sang**, và "cấp trang" là câu hỏi
theo chuẩn HTML chứ không theo độ sâu: `<header>`/`<footer>` thuộc về phần tử sectioning gần
nhất, nên cái nào không có phần tử đó ở trên thì là của cả trang, dù bị bọc sâu bao nhiêu.
Footer còn được nhận ra qua class hoặc id bắt đầu bằng `footer` — rất nhiều site thật đánh dấu
kiểu đó chứ không dùng thẻ — nhưng header thì không, vì chữ `header` trong tên class thường là
hero. Thứ gì trang tự đánh dấu `aria-hidden="true"` đều bị bỏ: đó là dấu của chính tác giả cho
phần trang trí và phần lặp.

**`<svg>` chỉ thành `icon` khi nền tảng có đúng tên đó.** Tên được đọc theo cách trang nguồn
viết — `<use href="#ri-search-line">`, `aria-label`, `<title>`, hoặc class của bộ icon (`ri-`,
`fa-`, `lucide-`, `bi-`) — chuẩn hoá rồi TRA trong 3.227 tên RemixIcon nền tảng có sẵn. Cái nào
không khớp thì bỏ, vì icon sai còn tệ hơn không có: "Acme Store" ra icon cửa hàng ở chỗ vốn là
logo chữ thì không cách nào phân biệt với một kết quả đúng. Màu của nó không bao giờ bị ghi, nên
icon import về vẫn đi theo theme.

**Các `<details>` liền nhau gộp thành MỘT accordion**, mỗi `<summary>` là nhãn của một mục — và
tất cả được mở ra trước khi đo, vì `<details>` đang đóng đo ra bằng 0 và một trang FAQ sẽ về chỉ
có câu hỏi không có câu trả lời.

**Khối code được lấy nguyên khối.** Mọi bộ tô màu cú pháp đều bọc từng token trong một `<span>`
riêng, nên đi vào bên trong sẽ biến một đoạn config hai mươi dòng thành bốn mươi khối văn bản
rời. Khoảng trắng bị gộp như mọi văn bản khác: nền tảng này không có element code để giữ lại,
nên kết quả trung thực là một đoạn văn bạn có thể tự định dạng lại.

**Section đã ghim vẫn ghim.** Đây là thứ duy nhất importer đọc từ computed style thay vì từ
cây, vì nó là một QUYẾT ĐỊNH bố cục — thanh danh mục sticky hay thanh mua hàng fixed nằm đó để
luôn trong tầm mắt, và bản sao trôi mất khi cuộn thì không còn là cùng một section. Nó đến kèm
offset và thứ tự lớp bên cạnh `position`, đúng ba key `sb_set` gieo, nên nó không chui xuống
dưới section liền sau. `absolute` và `relative` cố tình không được mang theo: chúng mô tả vị
trí một hộp bên trong bố cục mà bản import này không sao chép.

**Là dịch lại, không phải sao chép, và đó là toàn bộ thiết kế.** Nền tảng CÓ một lối thoát
hiểm cho phép sao chép nguyên trang — `custom-code` nhúng markup thô nguyên văn — nhưng dùng
nó sẽ ra một trang Store Builder mà không inspector nào sửa được, không có cascade responsive,
không bind vào đâu, và kéo theo CSS cùng script của người khác. Giống nhất về hình thức, và
là ngõ cụt về cấu trúc.

Nên chỉ sáu loại đi qua biên — section, heading, text, image, button, list — và mỗi loại đến
nơi dưới dạng element render được nó. Thứ **không** được chép: màu, font, khoảng cách và bố
cục của trang nguồn.

**Token lấy từ chính trang bạn đang mở**, đúng rule 0 của skill thiết kế: màu và độ đậm của
heading đầu tiên, màu và cỡ của dòng body đầu tiên, nền và bo góc của nút **không trong suốt**
đầu tiên (nút trong suốt là link điều hướng — lấy "nền" của nó thì mọi nút import về đều
không có nền), padding của section đầu tiên và max-width của block đầu tiên. Trang đích rỗng
thì không có token nào và mọi element rơi về mặc định của chính nó — bịa ra một bảng màu cho
nó chính là thứ rule 0 sinh ra để ngăn.

**NỀN TẢNG tự tải ảnh khi có thể.** `sb_media_upload` và mọi ảnh mà một lần import chép về giờ
hỏi `POST /api/media/{siteId}/from-url` trước: byte đi một chặng thay vì hai, và content type do
chính origin trả lời chứ không phải dựng lại ở đây. Deployment chưa có route đó thì rơi về đường
cũ — tải file rồi post multipart, không đổi gì. **ĐỊA CHỈ BỊ TỪ CHỐI LÀ ĐIỂM DỪNG** — nền tảng
không tải bất cứ thứ gì ngoài internet công cộng (loopback, dải nội bộ, endpoint metadata của
cloud), và server này cũng sẽ không tải hộ nó, vì làm vậy là đi vòng qua kiểm tra chứ không phải
thoả mãn kiểm tra.

**Ảnh được chép về, không hotlink.** Mỗi ảnh được upload vào media library của site và node
trỏ vào bản chép; ảnh nào upload hỏng thì giữ URL gốc, vì một tấm ảnh hiện được vẫn hơn một
khung trống. Truyền `upload_images: false` để bỏ qua.

**Nội dung rơi vào TRONG dải giữa** — trước global footer đầu tiên, sau header. Nối thêm vào
cuối ROOT là cách hiển nhiên và nó phá bẫy 3 trên mọi trang có global footer: nền tảng từ chối
cả lần lưu, còn người gọi thì bị báo về một luật dải mà họ không hề cố ý vi phạm.

Trang tự dựng bằng script sau khi load, hoặc trang sau đăng nhập, sẽ đọc ra mỏng hoặc rỗng —
kết quả nói rõ đã bỏ qua những gì và vì sao.

**`coverage` là nửa mà `skipped` không nói được.** LẮNG XUỐNG KHÔNG PHẢI LÀ HỎNG: một trang
đọc lúc nó còn đang tự dựng sẽ trả về nhỏ gọn, trông rất đúng, `skipped` RỖNG và không lỗi ở
đâu cả. Nên mọi kết quả — dry run, lần chạy thật, và từng trang của `sb_import_site` — đều
mang theo phần trăm chữ của chính trang đó còn sống sót. Mẫu số trừ đi MỌI chữ mà lượt quét đã
CHỦ ĐỘNG BỎ QUA, không chỉ khung trang — một khối `aria-hidden`, một phần tử bị coi là ẩn, một
control của form — vì bỏ qua có chủ đích không phải là mất: lượt quét đã nhìn thấy nó và chọn
không lấy, giống hệt khung trang, và tính nó vào kết quả sẽ khiến một site nhiều menu hoặc nhiều
phần trang trí đọc như một lần import hỏng trong khi nó đúng. Mẫu số cũng trừ luôn chữ mà lượt
quét KHÔNG BAO GIỜ lấy được, dù có ai chạm tới nó hay không — chữ trong một `<nav>`, trong các
option của `<select>`, trong `<textarea>` — vì những tag đó bị loại vô điều kiện bất kể chúng
nằm ở đâu trên trang, kể cả một `<nav>` trơ trọi ở cấp cao nhất mà không phải khung trang và
cũng không nằm trong bất kỳ section nào server này từng lấy. Cái vẫn bị tính là mất là khi lượt
quét THẤT BẠI trong việc chạm tới nội dung thật — hết ngân sách node giữa trang — nên số thấp
đáng để chạy lại trước khi đáng để đi điều tra; đôi khi nó cũng là câu trả lời thật thà và khi đó
nó minh oan cho trình import — một trang danh mục chỉ có breadcrumb thì đúng là rỗng thế. Trang
không có chữ nào để đo thì trả 100, vì trang rỗng không phải là import hỏng.

### Đo một lần import

`SB_FIDELITY=1 npm run fidelity` đọc các fixture trong `test/fidelity/fixtures.json`, dựng mỗi
trang thành một trang TẠM trên site mà `SB_SITE` chỉ định, chụp cả trang gốc và trang dựng ở
từng bề rộng, rồi ghi ra `test/fidelity/baseline.json`.

Ba chỉ số, vì chúng hỏng độc lập với nhau: `visual` là phần trăm pixel khác nhau (thấp hơn thì
tốt hơn), `content` là `coverage` (cao hơn thì tốt hơn), `structure` là khoảng cách giữa cây
của trang gốc và cây của trang dựng (thấp hơn thì tốt hơn). Một trang trắng đạt điểm hoàn hảo
ở hai trong ba chỉ số, và đó là lý do phải có cả ba.

Nó viết vào một site ĐANG SỐNG và từ chối chạy nếu thiếu cờ. Các trang tạm này — không phải
bản nháp để giữ lại, mà là dùng xong thì xoá — mang tên `zz-fidelity-*` và bị xoá theo id mà
lệnh tạo trả về, trong một `finally`.

**Chỉ có SỰ DI CHUYỂN của `visual` và `structure` là có ý nghĩa — đừng bao giờ đọc con số tuyệt
đối.** Cả hai đều mang một mức sàn cố định: trang tạm được tạo bằng một body trần
`{name, slug, type}`, nên không có header hay footer chung nào được gắn vào (chuyện đó nằm
trong `siteChrome` của `sb_page_create`, và ở đây bị bỏ qua), nên ảnh chụp của trang gốc mang
theo phần khung mà bản dựng không bao giờ có cơ hội khớp; còn `toSpecs` bọc mỗi lần chụp trong
một section, nên cây được dựng luôn sâu hơn cây đã chụp một cách có chủ đích từ thiết kế. Không
mức sàn nào trong hai cái đó là lỗi cần đi sửa.

`visual` còn có thêm một nguồn nhiễu KHÔNG ỔN ĐỊNH nằm trên cả mức sàn đó: `diffImages` chia
cho `width × max(chiều cao gốc, chiều cao dựng)`, nên phần trăm báo ra là một hàm của TỔNG
CHIỀU CAO trang gốc. Một băng khuyến mãi cao hơn, một carousel dừng ở slide khác, một ảnh lazy
load xong muộn hơn lần trước — bất cứ thay đổi nào trong số đó cũng đổi mẫu số và làm `visual`
di chuyển mà trình import chẳng có gì thay đổi cả.

Độ nhiễu riêng của `visual` vẫn chưa đo được — nó cần quyền ghi vào site mà môi trường này từ
chối — nhưng nửa offline (`content` và `structure`) đã được chạy nhiều lần trên một cây không
đổi, cách nhau vài phút. Bốn trong năm fixture ra kết quả GIỐNG TUYỆT ĐỐI mỗi lần. Fixture thứ
năm, `modelcontextprotocol.io/` (trang này tự dựng bằng script), KHÔNG phải một lần lệch giữa
nhiều lần chạy ổn định — nó dao động giữa đúng hai trạng thái: `content 76 / structure 9.6` và
`content 87 / structure 11.9`, vì cửa sổ lắng của `capture` bắt trang ở một điểm khác nhau
trong một phần số lần chạy. `structure` không đổi qua mọi lần sửa cách đo `content` (lỗi đơn vị
đo, rồi lỗi mẫu số bỏ sót phần bị chủ động bỏ qua bên dưới) — vẫn đúng hai giá trị đó; chỉ
`content` di chuyển, và di chuyển KHÁC NHAU ở mỗi trạng thái, vì hai trạng thái DOM khác nhau ở
lượng khoảng cách đó là do bị bỏ qua chứ không chỉ do thật sự mất. Khoảng cách giữa hai trạng
thái ở `structure` (2.3) LỚN HƠN ngưỡng dung sai 1.5 điểm của `scoreboard.ts`, nên hai lần chạy
bình thường so với nhau đôi khi sẽ báo một sự di chuyển ảo trên đúng fixture này mà trình import
chẳng có gì thay đổi. Đừng nâng ngưỡng dung sai để che nó đi — nhiễu hai trạng thái của một
trang không phải là mẫu để đặt một ngưỡng chung, và cách sửa khả dĩ hơn là làm cho việc lắng của
`capture` ổn định hơn với một trang còn đang tự dựng, không phải nới rộng scoreboard.

**`SB_FIDELITY_OFFLINE=1 npm run fidelity` chấm `content` và `structure` mà không cần site
nào cả.** Cả hai đều lấy ra chỉ từ `capture()` — `content` chính là `coverage`, `structure` là
`shapeDistance` giữa cây của trang gốc và đầu ra của `toSpecs` — nên không cần tạo trang, lưu,
chụp ảnh hay xoá gì hết. `visual` cần một bản dựng đã render để so khớp, và việc dựng đó chính
là cái ghi mà tầng phân quyền của repo này từ chối ở một số môi trường; chế độ offline là thứ
vẫn trả lời được hai chỉ số còn lại ở đó. Mỗi dòng thiếu `visual` — KHÔNG PHẢI BẰNG KHÔNG — vì
số không sẽ đọc thành một khớp pixel hoàn hảo mà chẳng có gì được đo cả — và mỗi dòng đều mang
`mode: 'offline'` để một lần chạy `full` sau này không bao giờ bị đọc nhầm thành hồi quy trên
một chỉ số mà lần chạy offline chưa từng chạm tới. Không cần `SB_SITE` hay `SB_TOKEN` ở chế độ
này, vì không có gì trong đó chạm vào site cả. `test/fidelity/baseline.json` đã commit hiện chỉ
là baseline offline, vì lần chạy đầy đủ cần tạo trang trên site — thứ bị tầng phân quyền từ
chối ở môi trường đã tạo ra nó.

Chính `structure` cũng đổi ở bên dưới: `shapeOf` (`src/domains/site/shape.ts`) giờ coi một nút
có đúng một con là TRONG SUỐT — con của nó thế chỗ nó, không thêm độ sâu, không thêm mục fanout
nào — vì `toSpecs` luôn chèn đúng một lớp bọc như vậy (`flex-block`) giữa một section và các
con của nó, và hằng số này của riêng cách dựng của mapper từng lấn át điểm số của một trang nhỏ:
`example.com` đo được khoảng cách `structure` là 40 so với chính bản dựng đúng của nó, chỉ vì
một lớp bọc đó. Luật này cũng gộp cả một CHUỖI lớp bọc như vậy, và nó không che giấu một mất mát
thật — một container thật sự biến mất (khác với một cái chỉ bọc một con duy nhất) vẫn có nhiều
hơn một con của riêng nó và không bao giờ trong suốt.

**Bỏ trần số node đã làm baseline dịch chuyển, và đó chính là mục đích.** `ttgshop.vn/` tăng từ
19% → 100% trên `content` khi mặc định không còn cắt ở 400 node nữa, và `structure` cũng dịch
theo (0 → 0.4) — một số node khác đi là một cây khác, không chỉ là một số khác — nên `structure`
dịch chuyển ở ĐÚNG fixture này do ĐÚNG thay đổi này là điều đã lường trước, không phải một hồi quy
cần truy tìm. Bốn fixture còn lại không bị ảnh hưởng: `quy-dinh-bao-hanh` đã ở 100% ngay cả khi
còn trần cũ (nội dung của nó chưa bao giờ chạm 400 node), còn `modelcontextprotocol.io/`,
`rust-lang.org/` và `example.com/` đều còn cách trần rất xa — sự dịch chuyển nhỏ (hoặc không có)
của chúng là nhiễu giữa các lần chạy mà phần trên đã ghi lại từ trước, không phải do thay đổi này.

## `sb_import_site`

Đọc **cả một website** từ một URL và tạo cho mỗi trang tìm được một **trang nháp** riêng ở
đây. `sb_import` đọc một trang vào trang đang mở; tool này tìm ra website đó CÓ NHỮNG TRANG
NÀO, tạo một trang cho mỗi cái, rồi đổ nội dung vào.

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `url` | string | Một trang bất kỳ của website đó |
| `site_id` | string? | Không truyền thì lấy `SB_SITE` |
| `max_pages` | number? | Mặc định 12 |
| `depth` | number? | Không có sitemap: đi theo link sâu mấy tầng, mặc định 1 |
| `include` | string[]? | Chuỗi con của path cần giữ — **thắng** bộ lọc hạ tầng |
| `exclude` | string[]? | Chuỗi con của path cần bỏ |
| `max_images` | number? | Mặc định 24, cho **toàn bộ** lần import |
| `max_nodes` | number? | Mỗi trang — không có trần theo mặc định, giống `sb_import` |
| `upload_images` | boolean? | Mặc định **true** |
| `homepage` | boolean? | URL vào rơi vào trang chủ sẵn có của site này, mặc định **true** |
| `theme` | boolean? | Patch theme của site này từ màu của trang entry, mặc định **true** — TOÀN SITE |
| `dry_run` | boolean? | Mặc định **true** — trả về danh sách trang và không tạo gì cả |

**Mỗi trang chỉ một lần.** URL được gộp về địa chỉ mà chính trang khai trong
`<link rel="canonical">`; bản dịch được gộp về bản gốc, nhưng chỉ khi tìm thấy cả hai, nên site
phục vụ mọi thứ dưới một locale vẫn giữ nguyên; `/blog/page/2` bị bỏ vì nền tảng này tự render
phân trang của nó; và `robots.txt` của site được tôn trọng, khớp dài nhất thắng, trừ đúng URL mà
người gọi đã nhập.

**Danh sách của chính chủ site trước, bò link sau.** `robots.txt` được đọc để tìm dòng
`Sitemap:` trước khi đoán `/sitemap.xml`, vì rất nhiều sitemap thật nằm chỗ khác — nền tảng
bán hàng đặt tên `/sitemap_products_1.xml`, CMS đặt theo ngày. Một sitemap tốn đúng một lần
fetch, không cần trình duyệt, và nó liệt kê cả những trang không có link nào trỏ tới. Chỉ khi
không có sitemap (hoặc sitemap chỉ liệt kê đúng một trang — thứ mà một generator cấu hình dở
sinh ra) thì mới bò link, mỗi trang một lần mở trình duyệt, chặn bởi `depth` và bởi số trang
tối đa. Không có nút để ép bò link: người gọi muốn ít trang hơn sitemap thì cần `include` hoặc
`max_pages`, chứ không phải một cách chậm hơn để ra cùng danh sách đó.

**Thứ tự là một phần của câu trả lời.** Một sitemap có thể liệt kê năm nghìn URL còn trần chỉ
lấy một tá; lấy một tá đầu theo thứ tự trong file thì được một website gồm bất cứ thứ gì
generator sinh ra trước — với một shop thì đó là mười hai trang sản phẩm và không có trang
chủ. Nông trước — gốc, rồi `/about`, rồi `/blog/mot-bai` — chính là dàn ý của website đó.

**Tiền tố lặp lại được báo, vì ở đây chúng không phải là trang.** Bốn mươi URL dưới
`/products/` trên nền tảng này là MỘT template có binding cộng với một danh mục hàng:
`/products/{slug}` trỏ về trang đã publish thuộc type `product`. Import chúng thành trang tĩnh
sẽ ra một shop mà mọi giá đều là chữ chết và không mua được gì. Kết quả nêu tên tiền tố và số
lượng trước khi tạo bất cứ thứ gì; `exclude` để loại chúng ra.

**Một sitemap INDEX tự nêu tên LOẠI của từng sitemap con, và cái tên đó được đọc chứ không bị
vứt đi.** `sitemap.xml` của một shop hầu như luôn là một index, và các sitemap con của nó được
đặt tên theo thứ chúng chứa — `sitemap_product.xml`, `sitemap_category.xml`,
`sitemap_brand.xml` (đúng hình dạng của ttgshop.vn), hoặc `product-sitemap.xml` (Yoast),
`sitemap_products_1.xml` (Shopify) — và quy tắc báo tiền tố ở trên lại mù trước đúng cái ca
quan trọng nhất: một shop mà URL sản phẩm nằm ngay ở GỐC site, không chung tiền tố nào cả. Mọi
URL lấy từ một sitemap con được đặt tên theo loại BẢN GHI — `product`, `category`,
`collection`, `brand`, `tag` — bị **loại khỏi kế hoạch theo mặc định**, cùng lý do như quy tắc
tiền tố: ở đây là một template có binding cộng với bản ghi thật, không phải N trang tĩnh. Kết
quả báo từng loại kèm số lượng (`entity_pages`, nằm cạnh mọi nhóm tiền tố); `include` vẫn đưa
được một cái cụ thể vào. Một sitemap con đặt tên theo loại TRANG — `page`, `article`, `post`,
`blog` — vẫn được giữ như một ứng viên bình thường, không bị ảnh hưởng. Một sitemap không tự
nêu tên loại nào (`sitemap1.xml`, `sitemap2.xml`, một `sitemap.xml` phẳng) thì lên kế hoạch
đúng như trước nay — quy tắc này chỉ chạy khi chính sitemap của site nói ra.

**Một header dùng chung mang menu.** Các trang vừa tạo được gom vào một global `header` — sửa
một lần là cả site đổi — dựng từ CHÍNH những trang đó chứ không từ nav của trang nguồn, vì nav đó
trỏ sang website đã sao chép và một nửa trỏ vào những trang mà trần số trang đã bỏ lại. Mỗi trang
sau đó mang một tham chiếu tới nó, đứng đầu trong các con của ROOT — đúng hình dạng mà chính
decompose của nền tảng ghi ra. Bỏ qua khi site đã có header, vì thêm cái nữa là hai header chứ
không phải một menu; `nav: false` để tắt. Dưới hai trang thì không chạy — menu tới một trang là
link trỏ vào chính nó.

**Link giữa các trang import về trỏ vào ĐÂY, không dẫn ngược sang nguồn.** Link bắt được vốn giữ
URL tuyệt đối của trang nguồn, nên trước đây site về có mười hai trang mà không có đường nào tới
được trang nào — mọi cú bấm đều rời sang website đã sao chép. Chỉ những đích **thật sự được
import** mới bị viết lại: link cùng origin mà trần số trang bỏ lại thì giữ nguyên URL gốc và được
đếm ở `links.still_off_site`, vì một link ra ngoài chạy được vẫn hơn một link nội bộ 404, và con
số đó chính là thứ bảo bạn nâng `max_pages`.

**Form được báo lại chứ không dựng lại.** Các trường của nó là bộ từ vựng `mapTo` mà server kiểm
tra, và `sb_store action:"form"` mới là chỗ nắm việc đó — nên `forms_found` nêu trang đã có gì và
ghi chú nêu tên công cụ. Một trang liên hệ về mà không có cách nào liên hệ, lại chẳng nói vì sao,
mới là thất bại đáng tránh.

**Bản xem trước nói rõ từng trang sẽ RƠI VÀO ĐÂU**, không chỉ tìm được gì: trang nào nhập vào
trang chủ sẵn có, slug nào đã bị chiếm (trang đó bị bỏ qua, vì nền tảng đổi tên slug trùng rồi
trả 200). Đọc danh sách trang của site này thì cần credential, còn hỏi một website lạ có gì thì
không — nên lượt dry run không đọc được site sẽ báo `landing_unknown` thay vì đoán bừa.

**Một trang hỏng không làm dừng cả lượt.** Import cả site không thể nguyên tử — mỗi trang là
một lần tạo và một lần lưu riêng — nên hình dạng trung thực là kết quả theo từng trang: `built`
liệt kê cái đã xong, `failed` liệt kê từng URL kèm lý do. Trang có slug đã tồn tại thì được để
yên chứ không tạo, vì nền tảng ĐỔI TÊN slug trùng rồi trả 200 — chạy lại lần hai sẽ âm thầm
nhân đôi cả website.

**Token lấy từ site này, một lần.** `sb_import` đọc token từ trang đang mở; ở đây phần lớn
trang đích chưa tồn tại và số còn lại thì trắng, nên đọc theo từng trang sẽ cho trang đầu tiên
mặc định của element và mọi trang sau đó mặc định của trang trắng ngay trước nó. Lấy từ trang
đang mở nếu có, không thì từ trang chủ của site này.

**Màu và cỡ chữ của trang NGUỒN chuyển vào theme của site ĐÍCH, không đóng cứng lên node.** Đọc
đúng một lần, từ chính bản capture của trang entry — cùng một bản đã lấy để dựng nội dung trang
đó, nên không fetch lại lần hai — thành năm vai màu (heading/text/primary/muted/background) và
một thang cỡ chữ heading/text, rồi patch vào `PUT /api/sites/{siteId}/theme`. Nó patch ĐÚNG các
field được nêu tên và không bao giờ thay cả document — vai nào trang nguồn không thể hiện thì
được để yên, không bị xoá về rỗng, vì một patch trông như rỗng gửi vào endpoint chỉ-biết-thay-
toàn-bộ này chính là hình dạng đã từng làm một site thật mất cả bảng màu. Báo qua
`theme.changed` (`what`/`from`/`to`, đúng hình dạng của `sb_theme`) hoặc `theme.failed`; một
lần ghi theme không thành công là một dòng báo, không bao giờ là lý do làm hỏng cả lượt import —
đúng luật mà một lần upload ảnh thất bại đã theo, bằng cách giữ nguyên URL gốc của node.

**Một khi lần ghi đó THỰC SỰ thành công, các node được import không còn mang màu riêng nào cả —
chúng đeo preset của theme**, đúng lớp mà `sb_node_read` đã làm phẳng ra cho bạn xem, nên trang
import được RE-THEME được: một lần sửa `sb_theme` sau này sẽ tô lại nó cùng mọi trang khác chứ
không để nó kẹt lại với ngày nó được import. Đây là một lần SỬA LỖI thật, không phải thiết kế
ban đầu: một giá trị đóng cứng trên node luôn thắng preset bên dưới nó VĨNH VIỄN, và tool này
từng vừa patch theme vừa đóng cứng đúng quan sát đó lên mọi heading, text và button trong cùng
một lượt chạy — nên lần ghi theme phía trên vô hình trên đúng những trang nó vừa được ghi cho.
`headingColor`/`textColor`/`buttonBg`/`buttonColor` là những gì một preset mặc định phân giải
qua theme; `headingWeight`/`textSize`/`buttonRadius` và `padding`/`maxWidth` của section thì
KHÔNG — không preset nào mang độ đậm chữ hay cỡ chữ thân bài, và theme không có token nào cho
hình khối hay khoảng cách cả — nên bốn giá trị đó vẫn được đóng cứng dù có ghi theme hay không.
Khi `theme:false` được truyền, hoặc trang entry không thể hiện màu/kiểu chữ nào đọc được, hoặc
lần ghi thất bại, thì không có preset nào để phân giải qua, và mọi field mà token của site này
mang — kể cả màu — đều được đóng cứng lên node, giống như `sb_import`.

**Việc này TOÀN SITE, và `theme:false` để bỏ qua.** Lần ghi này chạm vào mọi trang site đã có
sẵn, không chỉ những trang lượt import này tạo ra — người gọi muốn bê cấu trúc của một đối thủ
lên một site đã có bộ nhận diện riêng của merchant cần nói điều đó TRƯỚC khi dựng bất cứ thứ gì,
không phải phát hiện ra sau. Vì màu thật chỉ đọc được từ một lần capture bằng trình duyệt thật
của trang entry, còn dry run phải giữ được tính rẻ, an toàn offline (một kế hoạch tìm ra từ
sitemap không mở trình duyệt nào cả), nên dry run không thể cho xem giá trị sẽ đặt — nó trả về
`theme_note` thay vào đó, nêu rằng một patch sắp tới và `theme:false` sẽ bỏ qua nó. Giá trị thật
chỉ hiện ra khi bắt đầu dựng trang, dưới dạng `theme.changed`.

**Giới hạn cần nói thẳng:** hai cách chấm điểm `content` và `structure` không thấy được màu,
nên không cái nào chứng minh được việc này có ích; chỉ `visual` mới thấy, và môi trường này
chưa chạy được `visual` qua mạng thật lần nào. Thứ cần để chốt việc này là một lần so sánh
`visual` — có mạng thật — giữa một trang import với trang nguồn, trước và sau khi patch.

**Ảnh upload một lần cho cả lượt import.** Logo, dải phương thức thanh toán, huy hiệu ở footer
xuất hiện trên mọi trang của một website thật; upload theo từng trang sẽ nhét vào media library
của merchant mười hai bản mỗi thứ.

**Không publish gì cả, và ba việc lần import không làm hộ bạn.** Header và footer của trang
nguồn bị bỏ có chủ đích — site này có header/footer riêng dạng global, và một menu thứ hai trỏ
sang website người khác còn tệ hơn là không có. Không có menu nào nối các trang mới lại với
nhau. Và chưa có gì được nhìn ở 390px. `sb_look` từng trang ở ba khổ, rồi mới `sb_publish`.

**MỘT BỘ PANEL KÈM HÀNG NÚT TRỞ THÀNH `tab`, và nhãn là thứ quyết định.** Nền tảng tổng hợp toàn
bộ hàng nút của tab từ `specials.label` của từng `tab-content` (`render/nodes/tab/html.go`), nên
một tab không nhãn là một chồng panel đeo bộ điều khiển không ai bấm được. Vì thế "có đọc được
nhãn không" vừa là câu hỏi đúng vừa là DẤU HIỆU PHÂN BIỆT đúng — dấu panel-set cũng rơi vào một
lưới sản phẩm tình cờ ẩn một thẻ, mà thứ lưới đó không có chính là hàng nhãn.

Ba cách ghép, mạnh nhất trước, vì một nhãn SAI còn tệ hơn không nhãn — nó đặt tên bộ sưu tập này
lên sản phẩm của bộ khác: **ARIA** (`[role=tab][aria-controls]`) nói thẳng ra; **giá trị `data-*`
dùng chung** (`<button data-id="7">` cạnh `<div data-id="7">`) là cách phần lớn script tab tự nối
dây và nó sống sót qua việc đảo thứ tự; **vị trí**, chỉ khi hàng nút có đúng bằng số panel. Mọi
panel phải ra được nhãn, không thì không phải tab — panel vẫn được giữ, trải phẳng, và phần bỏ
qua ghi `panel-set-without-labels`.

Đo trên ttgshop.vn: 93 bộ panel, không bộ nào có nhãn, vì nút tab của trang đó rỗng trong DOM và
do script điền. Có thể suy nhãn từ slug `data-url` nhưng đã từ chối: slug tiếng Việt trả về mất
sạch dấu, đúng là lỗi tự-bịa-nội-dung mà `default_seed_copy` báo trên seed của mọi nơi khác.

### Hiệu ứng vào, và những cách trượt câm của nó

`config.animation` được hầu hết thư viện phần tử cung cấp, mà không gì mô tả nổi nó. Mọi cách
làm sai đều render RA KHÔNG GÌ CẢ — không keyframes, không rule, không lỗi — qua save, publish và
render. `sb_traits_for` mang sẵn câu trả lời trên mọi phần tử có control này (`animation_values`
liệt kê đủ 46 type cùng giá trị hợp lệ của từng khoá), còn `sb_set` cảnh báo từng cách trượt:

- **Nó là OBJECT, không phải chuỗi như cái tên gợi ra:**
  `{ active: true, type, easing, intensity, trigger, delay, duration, repeat, alternate, range }`.
  Renderer đọc nó bằng `map[string]interface{}`, nên một chuỗi trần `"fade_in"` chính là giá trị
  zero.
- **`active: true` là BẮT BUỘC, và `type` đã lưu cố ý không được coi là đồng ý.** Panel giữ lại
  `type` khi tắt công tắc để bật lại thì khôi phục lựa chọn cũ — coi type đã lưu là đồng ý sẽ làm
  chuyển động một node mà tác giả đã tắt hẳn.
- **Type dùng GẠCH DƯỚI** — `fade_in`, `slide_up`, `slide_down`, `zoom_in`. `fade-in` mới là cách
  mọi công cụ web khác viết, và chính bảng của nền tảng có ghi chú cảnh báo cái bẫy này.
- **Nó ghi THEO BREAKPOINT, như mọi config khác.** Trước đây nó base-only và trang này từng nói
  vậy: compiler đọc object không qua merge responsive, nên `sb_set` định tuyến lệnh ghi về base.
  Việc thêm `intensity` chấm dứt điều đó — một khoảng cách là một *đại lượng*, mà đại lượng thì
  phải đi theo breakpoint — nên khoá rời sổ migration của nền tảng và việc định tuyến tự dừng.
  Cái bạn được là thứ merchant hỏi nhiều nhất: **tắt hiệu ứng trên mobile.**
- **`alternate` đi với `repeat` hữu hạn sẽ bị bỏ, và lý do đáng biết.** Số lần lặp chẵn kết thúc
  ở keyframe `from`, mà mọi keyframe hiệu ứng vào đều bắt đầu ở `opacity: 0` — nên node sẽ xuất
  bản ra VÔ HÌNH: chạy đúng trên canvas và không bao giờ hiện với khách. Nó chỉ được tôn trọng
  khi đi cùng `repeat: "infinite"`.
- **Thiếu `intensity` KHÔNG phải là `medium`.** Nó giữ mức dự phòng 0.5s thay vì mức mà intensity
  hàm ý (soft 0.4 / medium 0.6 / strong 0.9).

`easing` là ca nhẹ và được báo khác đi: giá trị lạ rơi về `ease`, nên hiệu ứng vẫn chạy, chỉ mang
đường cong không ai chọn. `intensity` lạ cũng vậy — không biến nào được phát và keyframe dùng
khoảng cách có sẵn của chính nó. Renderer tự phát rule `prefers-reduced-motion` cho từng node,
bạn không phải lo.

**Hiện-dần-khi-cuộn chính là `trigger: "view"`.** Trang này suốt mấy tháng nói rằng nó hoàn toàn
không có lời giải — rằng đây là hiệu ứng VÀO bắn ở lần vẽ đầu tiên, và một dải hiện dần khi khách
cuộn tới không thể dựng ở đây bằng bất kỳ công cụ nào. Dựng được: `animation-timeline: view()`
giờ đã có ở cả bốn engine, nên trigger biên dịch thành một override `@supports` đặt trên rule
thường — không JavaScript, không island, và những engine chưa có thì vẫn chạy hiệu ứng ở lần vẽ
đầu, nên không ai mất gì. `range` là điểm hoàn tất tính theo phần trăm quãng phần tử đi vào khung
nhìn, kẹp trong 1-100, mặc định 60.

Thứ vẫn chưa có lời giải là kiểu chạy-một-lần-với-thời-lượng-cố-định khi cuộn tới: view timeline
tua theo cuộn, và nền tảng sẽ thêm kiểu đó thành giá trị trigger thứ ba chứ không định nghĩa lại
giá trị này.

### App, và một chuỗi ký tự khiến block của chúng không dùng được

Mọi route về app đều có trong catalog, và `GET /api/sites/{siteId}/apps/blocks` trả về các hàng
palette mà app đã cài đóng góp — nhưng thứ duy nhất cần để ĐẶT một block thì chỉ tồn tại trong Go.
`page/appblocks.go` ghi rõ: `specials.appBlockRef` là `"<installId>/<blockKey>"`, và cả hai nửa
đều trở về trên mỗi hàng block. Agent có danh sách, có route, và không có cách nào biến một hàng
thành một node. Giờ `sb_api_find` mang nó trên mọi call sheet `/apps` hoặc `/builtin-apps` — đặt
block là việc của `sb_add`, vốn đã nhận đúng specials cần, nên không thêm tool nào.

Call sheet mang theo hai cái bẫy. **Đừng bao giờ tự viết `appBlockId` hay `appBlockHash`**: đó là
dấu SERVER đóng khi nó compose, viết vào thì lần lưu sau sẽ decompose node của bạn đè lên app. Và
**sửa bên trong một block đã compose thì không được lưu ở đâu và không được báo ở đâu** — lần lưu
rút cả cây con về lại tham chiếu, nên block được cấu hình qua props/slot của chính nó, không phải
bằng cách sửa thứ nó đã render.

**App built-in thì server này CÀI được; app marketplace thì không.**
`POST /api/sites/{siteId}/builtin-apps/{key}` nhận một trong tám khoá — mail, multilingual, agent,
chat, booking, loyalty, payments, courses — và mô tả của chính tham số đó là nơi duy nhất tập khoá
cài được tồn tại trên đường truyền, vì `GET /builtin-apps` trả lời thứ *đã cài*. Nó ghi hai trên
tám cho tới khi chú thích bên nền tảng được sửa. App marketplace cài qua màn hình đồng ý OAuth cần
người duyệt, nên câu trả lời thành thật là nhờ chủ shop cài rồi đọc lại `/apps/blocks`.

**`action: "chrome"` cho mọi trang MỘT header dùng chung.** `sb_review` báo `siteChrome` với bất
kỳ site nào có hai trang trở lên mà không có global section — mỗi trang tự mang header riêng, đổi
menu là bấy nhiêu lần sửa, các bản sao trôi dạt, và khách gặp một site hơi khác nhau ở mỗi cú
nhấp. Đó là thứ cơ bản nhất mà một website có còn trang tự sinh thì không.

Luồng sửa việc này **đã tồn tại** và không ai ngoài MỘT tool với tới được: `sb_import_site` dựng
đúng thứ đó từ các trang nó vừa tạo. Site dựng bằng cách khác — pattern, `sb_add`, cửa hàng gieo
từ `sb_store` — phải làm lại bằng tay: tạo master, biết rằng `document` của nó có dạng tài liệu
trang nhưng gốc là SECTION, rồi cho mỗi trang một con của ROOT mang `globalRef` + `globalKind`,
đặt ĐẦU TIÊN, vì header nằm sau nội dung giữa là lỗi thứ tự band ở lần lưu kế tiếp.

Menu dựng từ **chính những trang site đang có**, trang chủ trước, mỗi trang gọi tên theo cách một
menu gọi chứ không theo cách cơ sở dữ liệu gọi. Diện mạo lấy từ TRANG CHỦ — rule 0, áp cho trang
mà cả site vốn đã đi theo. Truyền `footer: true` để làm footer dùng chung, và nó đặt CUỐI vì cùng
lý do thứ tự band.

Bỏ qua khi site đã có sẵn loại đó, vì hai header không phải là một menu, và bỏ qua khi dưới hai
trang, vì menu tới một trang là link tới chính nó. Nó **không nguyên tử và không giả vờ là thế**:
một trang không nhận header thì không huỷ cái header — master vẫn còn, các trang khác vẫn mang, và
việc từ chối được báo theo từng trang.

## `sb_theme`

**Quyết định thiết kế duy nhất chạm tới mọi trang.** Một style preset biên dịch thành rule class
nằm *dưới* giá trị riêng của node, nên mọi node chưa bị ghi literal đều đi theo token màu và text
style của site. Đổi một token ở đây là cách rẻ nhất để thay diện mạo cả site — và trước đây đó
lại là đòn bẩy duy nhất mà bộ công cụ đẩy bạn ra xa: `sb_node_read` báo được node đang tô gì,
còn tầng bên dưới nó thì không gì ghi được.

Gọi không tham số để ĐỌC những gì site thực sự có, khoá theo đúng cách preset phân giải — theo id
token (`heading`, `primary`) và theo slug text style. Site chưa từng lưu theme sẽ trả về theme
KHỞI ĐẦU và nói rõ điều đó, vì đưa `#111827` của starter cho một site có token heading màu hồng
là một màu sai đầy tự tin.

`colors` và `text_styles` **VÁ** vào tài liệu đã lưu: **thứ bạn không nêu tên thì được giữ
nguyên**. Đó không phải phép lịch sự mà là cách an toàn duy nhất để diễn đạt một phép vá trên
endpoint này. Lệnh ghi là THAY TOÀN BỘ TÀI LIỆU và không mặt nào có lịch sử theme — không
version, không restore — nên một body thiếu `colors` từng được lưu ngon lành, mang theo cả bảng
màu, toàn bộ text style và cả 58 preset. (Nền tảng giờ từ chối tài liệu không ra hình một theme,
việc đó chặn phần tệ nhất nhưng không làm cho một lệnh ghi thiếu trở nên an toàn.) Ở đây cố ý
không có tham số nào diễn đạt được ý "bỏ hết phần còn lại".

Id token hoặc slug mà site không có sẽ bị **từ chối**, kèm danh sách những cái có thật: mọi preset
phân giải qua các id đó, nên một id bịa ra sẽ được lưu và không gì đọc.

Publish lại sau khi đổi. Theme được biên dịch vào stylesheet của từng trang, nên trang đã lưu vẫn
giữ bảng màu cũ cho tới khi được publish lần nữa.

## `sb_store`

Chạy một luồng cửa hàng bắt buộc **đúng thứ tự**.

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `action` | `"checkout"` \| `"form"` \| `"chrome"` \| `"menu"` \| `"overlay_attach"` \| `"app"` | Luồng cần chạy |
| `site_id` | string? | Không truyền thì lấy `SB_SITE` |
| `language` | `"vi"` \| `"en"`? | `checkout` — ngôn ngữ nội dung, mặc định `vi`. `app` — ngôn ngữ đặt tên các trang scaffold |
| `page_name` | string? | `checkout` — ghi đè tên trang mặc định của editor. `form` — tạo một trang và đặt form lên đó |
| `headline` | string? | `checkout` — ghi đè tiêu đề trang. `form` — tiêu đề phía trên form được đặt |
| `template` | enum? | `form` — chọn một trong 17 template của nền tảng |
| `name` | string? | `form` — tên form trong danh sách của chủ shop. `overlay_attach` không có `overlay_id` — tên overlay mới |
| `footer` | boolean? | `chrome` — dựng **footer** dùng chung thay vì header |
| `node_id` | string? | `menu` — node menu trên trang đang mở |
| `menu_id` | string? | `menu` — một menu đã có; bỏ trống để dùng menu đầu tiên của site, hoặc tạo mới |
| `kind` | `"popup"` \| `"quickview"`? | `overlay_attach` — gắn loại overlay nào |
| `overlay_id` | string? | `overlay_attach` — một overlay đã có; bỏ trống để tạo mới từ seed của nền tảng |
| `list_id` | string? | `overlay_attach` + `kind:"quickview"` — node `list-dataset` mà quick view này gắn vào |
| `app_key` | enum? | `app` — cài app dựng sẵn nào |
| `dry_run` | boolean? | Mặc định **true** |

### `action: "form"`

Gieo bất kỳ template form nào của chính nền tảng: `login`, `register`, `forgot`, `reset`,
`verify`, `contact`, `subscribe`, `booking`, `feedback`, `event`, `quote`, `apply`,
`address`, `consult`, `stay`, `order`, `checkout`.

Editor có đủ mười bảy template còn server này trước đây chỉ mang MỘT, nên một cửa hàng dựng
bằng bộ tool này có trang thanh toán và không có gì khác — không form liên hệ, không đăng ký
nhận tin, và không có cả năm form xác thực, dù `forms.Type` khai báo chúng và `customerauth`
phục vụ chúng. Tự viết tay nghĩa là viết một field document mà các giá trị `mapTo` là bộ từ
vựng server kiểm tra — đúng thứ phỏng đoán mà catalog này sinh ra để loại bỏ.

Ba lệnh ghi, y hệt checkout trừ phần trang: tạo, **PUT form về NGUYÊN VẸN** (name và type
phải đi kèm, nếu không `Normalize()` đổi tên thành "Form" và chuyển type thành `custom`, sau
đó document bị từ chối), rồi lưu field document với node id mới. Nếu một lệnh ghi sau đó
hỏng thì form bị xoá lại — một form không ai thấy chính là thứ mồ côi mà lần thử lại sẽ nhân
đôi.

Mặc định nó **không tạo trang**. Đặt form ở đâu là quyết định thiết kế, và `/account` là
trang duy nhất không được tự do chọn: `membersOnlyRedirectTarget` đưa mọi khách bị chặn về
đó. Tự đặt form bằng `sb_add` rồi trỏ `specials.formId` vào id nó trả về.

**Hoặc truyền `page_name`** — kèm `headline` nếu muốn — để trang đó được tạo và form được đặt
lên nó trong cùng một lệnh: một trang mới — type `login`, `register` hoặc `contact` với các mẫu đó, còn lại `page` — mang một section, tiêu đề nếu có, và
một node `form` đã trỏ sẵn vào form vừa tạo. Đó là một lệnh ghi THỨ HAI có chủ ý và không
được phép huỷ lệnh thứ nhất. Form ĐÃ TỒN TẠI ngay khi ba lệnh của nó xong, nên một lần tạo
trang bị từ chối sẽ để form nguyên chỗ và báo `page_failed` chứ không xoá một form người gọi
đã yêu cầu — đó đúng là trạng thái họ có trước khi tham số này tồn tại, và form vẫn đặt được
bằng tay. Nhớ publish trang sau đó.

### `action: "checkout"`

`sb_review` nêu mười tám readiness gap. Phần lớn chỉ còn một lệnh gọi mỗi cái — một phương
thức giao hàng, một cổng thanh toán, một sản phẩm, một trang đúng type — vì call sheet đã nói
rõ những lệnh đó nhận gì. Checkout là cái còn lại, vì nó là **bốn lệnh ghi mà thứ tự chính là
hợp đồng**, và chỉ được ghi lại ở đúng một chỗ:
`editor/src/features/pages/checkoutPage.ts`.

1. `POST /forms` — tạo form đơn hàng.
2. `PUT /forms/{id}` — PUT lại **nguyên khối**, lấy giỏ hàng làm nguồn. `name` và `type` phải
   đi kèm, nếu không `Normalize()` đổi tên form thành "Form" và chuyển nó về `custom`, sau đó
   bước 3 bị từ chối với *"mappings do not fit this form type"*.
3. `PUT /forms/{id}/document` — lưu tài liệu trường với phương thức thanh toán và tuỳ chọn
   giao hàng **thật** của cửa hàng. Chuỗi option **chính là** giá trị: server đối chiếu câu
   trả lời thanh toán với id các cổng đã bật, và quy câu trả lời giao hàng ra phí theo **tên**
   phương thức. Nhãn tự gõ trong template thu về một câu trả lời vô giá trị.
4. `POST /pages` với TYPE `checkout`, rồi `POST /publish` — `/checkout` trỏ tới trang **đã
   publish** của type đó, nên bản nháp cũng như không có trang.

Thiếu một bước là nút Checkout mà mọi cart drawer mặc định mang theo sẽ trả 404.

**Dry run** (mặc định) trả về `plan` đã sắp thứ tự, `payment_methods` và `delivery_options`
form sẽ mang, kèm cảnh báo khi một trong hai danh sách rỗng — một select giao hàng rỗng chặn
đứng đơn hàng.

**Khi chạy thật** trả về `form_id`, `page_id`, `slug` và `published`. Hai khẳng định đi kèm,
vì cả hai lỗi đều im lặng:

- **Publish bỏ qua trang không có bản nháp để publish nhưng vẫn trả 200** (`service.go:650`,
  một `continue` trần), nên trang quay lại trong kết quả là bằng chứng duy nhất. Không có nó,
  một checkout 404 vẫn báo thành công.
- **Bất kỳ bước nào sau lệnh tạo mà hỏng thì form bị xoá lại.** Một form không trang nào bind
  tới hiện trong danh sách Forms của người bán như một mục "Form" rỗng, và lần thử lại hiển
  nhiên sẽ tạo ra cái thứ hai. Editor từng dính đúng lỗi này; cách khắc phục được sao lại chứ
  không phát minh lại.

Cả hai tài liệu đều được **sinh ra** từ `formTemplates.ts` và `checkoutPageSeed.ts` của chính
editor qua `npm run codegen`, không chép tay — một bản chép seed của nền tảng sẽ mục ngay lần
nền tảng sửa nó, và người đầu tiên phát hiện là khách mua hàng.

### `action: "chrome"`

Cho mọi trang **một** header dùng chung — hoặc, với `footer: true`, một footer dùng chung.

`sb_review` gọi khoảng trống này là `siteChrome`. Hai trang mà không có global section nghĩa
là mỗi trang tự mang header của nó: đổi menu là sửa từng trang một, các bản sao lệch dần, và
khách bấm sang trang nào cũng gặp một website hơi khác. Đó là thứ cơ bản nhất mà một website
có còn một website sinh tự động thì không — và trước đây chỉ đúng MỘT tool với tới được:
`sb_import_site` dựng nó từ chính những trang nó vừa tạo, còn site dựng bằng cách khác
(pattern, `sb_add`, một cửa hàng gieo bằng `sb_store`) thì phải làm lại bằng tay.

Bằng tay nghĩa là: tạo master, biết rằng `document` của nó có HÌNH DẠNG của một trang nhưng
gốc là **section** chứ không phải ROOT, rồi cho mỗi trang một con của ROOT mang
`specials.globalRef` + `globalKind` — **đặt đầu tiên**, vì header nằm sau nội dung giữa là
lỗi thứ tự band và lần lưu kế tiếp bị từ chối (bẫy 3). Footer thì đặt cuối, cùng một lý do.

Menu được dựng từ chính các trang site đang có, trang chủ trước. Diện mạo thì đọc từ **trang
chủ** — quy tắc 0 áp cho cả site thay vì cho một trang: pattern mà phần còn lại của site đang
theo chính là thứ header của nó nên mặc. Trang chủ trống thì không sinh token nào, thay vì
bịa ra một bảng màu.

**Bỏ qua chứ không làm hai lần.** Site đã có sẵn một section dùng chung thuộc loại đó thì trả
về `skipped` — thêm cái thứ hai là có hai header chứ không phải có menu — site dưới hai trang
cũng vậy, vì một menu tới đúng một trang chỉ là link tới chính nó. Cả hai được kiểm trước
nhánh dry run, nên một lần dry run cũng báo đúng như vậy.

**Không nguyên tử, và không được giả vờ là nguyên tử.** Một trang không nhận reference thì
không huỷ master: trang đó nằm trong `failed` kèm slug và lý do, còn những trang đã nhận nằm
trong `carried`.

**Dry run** (mặc định) trả về `would_create`, `menu` sẽ dựng, danh sách slug trong `onto`, và
token lấy từ đâu. **Khi chạy thật** trả về id của master trong `created`, `carried`, `failed`
nếu có, kèm nhắc nhở: một global section chỉ tới được khách qua trang đã **publish** sau đó —
trang mới lưu vẫn giữ chrome cũ.

### `action: "menu"`

Bind một node `menu` trên trang đang mở vào menu của site, rồi phân giải link của nó.

Một element `menu` rơi xuống canvas mang sẵn `specials.menuItems` của chính nó — Home /
Categories / Contact / About us, mọi `href` rỗng — đúng cái placeholder mà mọi lần thả mới
đều mang, editor hay agent cũng thế. Không có gì biến nó thành menu thật: menu của site là
một bản ghi RIÊNG (`GET/POST /api/sites/{siteId}/menus`), và không thứ gì server này từng
ship ghi `specials.menuId` hay thay chỗ seed đó bằng các dòng của chính site. Nên một trang
dựng hoàn toàn bằng bộ tool này ship kèm một menu gọi tên bốn trang mà site không có, và
không có cách nào sửa chữ ở một chỗ duy nhất.

**Renderer đọc `specials.menuItems` và không bao giờ đọc `menuId`**, nên với trang thì bản
chụp nằm trên node **chính là** menu. Bind mà không phân giải lại sẽ để node trỏ đúng vào một
menu thật mà vẫn render link chết — vì vậy đây là một luồng chứ không phải hai tham số.

Editor đóng lỗ này ngay khi một node menu vừa đáp xuống (`editor/src/features/menus/sync.ts`,
`ensureMenuBinding` → `syncBoundMenuNode`), và đây là bản sao từng lệnh ghi:

1. **Bind** — dùng `menu_id`, hoặc menu đầu tiên của site, hoặc tạo "Main menu" gieo từ chính
   các dòng node đang có, để việc bind không bao giờ làm đổi thứ đã nằm trên canvas.
2. **Đọc** lại items của menu đã bind cho mới (`GET /menus/{id}`).
3. **Phân giải** tham chiếu của từng dòng ra địa chỉ mà storefront thật sự phục vụ: `page`
   theo danh sách trang, `productCategory` → `/collections/{slug}`, `article` →
   `/blog/{slug}`, `blogCategory` → `/blog-categories/{slug}`, và `product` →
   `/products/{slug}` gom theo id, vì danh mục một shop thì không có trần còn cây category
   thì có. Chỉ những loại mà các dòng thật sự tham chiếu mới được gọi. **Một listing không
   đọc được sẽ hạ loại đó xuống `href` rỗng chứ không huỷ cả lần đồng bộ** — resolver của
   chính editor cũng nuốt lỗi đúng như vậy.
4. **Ghi** bản chụp đã phân giải vào `specials.menuItems`, mang theo `panelId` của từng dòng.
   Mega-panel cục bộ của một dòng là thứ menu cấp site không biết gì, nên một lần đồng bộ
   ngây thơ sẽ âm thầm xoá mất nó.

Bước 1 và 4 nằm trong **cùng một lần lưu**: node đã bind mà chưa có bản chụp là một trạng
thái không ai nên quan sát được.

Một `node_id` mà element của nó không gieo `specials.menuItems` bị từ chối theo type, có nêu
tên type, trước khi đọc bất cứ thứ gì.

**Dry run** trả về `plan` đã sắp thứ tự, `menu` sẽ dùng hoặc sẽ tạo, `items` sẽ ghi,
`unresolved` (dòng có trỏ tới một trang hay một entity mà không ra địa chỉ — một tham chiếu
treo cần đi sửa) và `unlinked` (dòng chưa từng trỏ vào đâu, đúng trạng thái của mọi dòng seed
mới). **Khi chạy thật** trả về `node`, `menu_id`, `created`, số item, và đúng hai con số đó.

### `action: "overlay_attach"`

Đặt một pop-up lên trang đang mở (`kind: "popup"`), hoặc trỏ một `list-dataset` tới panel xem
nhanh (`kind: "quickview"` kèm `list_id`). Không truyền `overlay_id` thì overlay được tạo
trước từ seed của chính nền tảng — `CreateOverlayInput.document` là bắt buộc, và một pop-up
rỗng là một hình chữ nhật trắng không ai tắt được.

**PHẢI ĐỌC LẠI TRANG SAU KHI GẮN, và đó là toàn bộ lý do thứ này phải là một tool.** Một
pop-up tới được trang qua một cạnh (`page_overlay_refs`) mà lệnh lưu trang thường không ghi
được: lệnh lưu SUY RA tập cạnh từ tài liệu ĐÃ COMPOSE, còn pop-up thì chưa có trong tài liệu
đó cho tới khi thứ khác đặt nó vào. Việc gắn là một lệnh riêng để phá vòng lặp ấy — và chừng
nào composer chưa đặt panel vào tài liệu mà phiên này đang giữ, **lần lưu kế tiếp sẽ suy ra
tập cạnh không có nó và gỡ luôn phần vừa gắn**, với 200 ở mọi bước.

Nên với một pop-up:

1. **Lưu** trang như nó đang có — cạnh không gắn được vào một bản nháp chưa lưu, và lần đọc
   lại phải trả về đúng việc của tác giả chứ không phải một bản cũ hơn.
2. **Tạo** pop-up, nếu người gọi không nêu tên cái nào.
3. **Gắn** — `POST /overlays/{id}/pages/{pageId}`, chính là cạnh đó.
4. **Đọc lại** trang.
5. Tìm node đã compose, đóng dấu `specials.overlayId`, và trả về id của nó.

Quick view thì tới trang qua config của chính LIST, và không bao giờ được có cạnh: một cạnh
sẽ khiến bước compose nối panel vào ROOT, đặt một bản `position: static` của nó dưới footer
của mọi trang dùng nó. Nên vũ điệu ngắn hơn — tạo panel nếu cần, ghi `config.quickviewId` lên
list rồi lưu trong cùng một lệnh, sau đó đọc lại để composer trộn master vào.

**Khoá config đó được ghi ở BASE, không điều kiện.** `nodeQuickviewChoice`
(`server/internal/page/quickview.go`) decode thẳng map `config` thô của node, không merge
theo breakpoint, cả khi quyết định lấy master nào lẫn khi compose chúng vào — nên một lựa
chọn ghi vào ô breakpoint là vô hình với compose và panel không bao giờ được trộn vào, ở mọi
môi trường, luôn luôn. `BASE_ONLY_CONFIG` không nêu khoá này; đó là một lỗ hổng trong sổ của
nền tảng chứ không phải một sự thật về khoá.

**Đã gắn rồi thì không làm gì**, đúng như cách kiểm tra của chính editor. Một pop-up đã
compose sẵn trên trang này — hoặc một list vừa đã trỏ tới overlay này VỪA đã có panel đã
compose — trả về `already_attached` và không ghi gì. Ghi lại không sai, chỉ phí: nó làm xê
dịch hàng rào revision của master dùng chung cho một mối nối đã có sẵn.

`kind: "quickview"` từ chối một `list_id` không phải `list-dataset`, có nêu nó là gì.

**Dry run** trả về `plan` đã sắp thứ tự (qua `redact()`) và `would_create` khi không có
`overlay_id`. **Khi chạy thật** trả về `kind`, `overlay_id`, có `created` hay không, và
`node_id` — node đã compose trên trang này, cũng là thứ `sb_set` sẽ tạo kiểu sau đó. Một lệnh
ghi đã xong mà lần đọc lại không thấy panel thì báo lỗi chứ không báo thành công.

### `action: "app"`

Cài một app dựng sẵn của nền tảng — `mail`, `multilingual`, `agent`, `chat`, `booking`,
`loyalty`, `payments`, `courses` — và tạo những trang nó cần mà việc cài không tạo.

`POST /api/sites/{siteId}/builtin-apps/{key}` BẬT app lên rồi dừng ở đó. Nó là một sự thật
("cửa hàng này đã bật Courses"), không phải một trình dựng trang — nên người cài `courses`,
soạn chương trình học rồi publish sẽ nhận **404 ở chính địa chỉ của khoá học**, vì
`/courses/{slug}` phân giải qua DEFAULT TEMPLATE của page type `course`, và không chỗ nào
nói ra cái trang lẽ ra phải dựng trước.

`scaffoldAppPages` (`editor/src/features/builtinapps/pageScaffold.ts`) là câu trả lời của
chính nền tảng, chạy ngay sau một lần cài thành công, còn `APP_SCAFFOLDS` là bản sao được
sinh ra của server này. **Hôm nay chỉ `courses` có scaffold** — bốn trang: template `course`,
`/courses`, `/learn` và `/my-courses`. Mọi key khác cài xong là hết việc, và kết quả nói đúng
như vậy.

**Trang không có slug được đối chiếu theo TYPE, và đó chính là trang chữa cái 404.**
`isPresent`, chép từ editor: một trang có `slug` khác rỗng là đã có nếu site có SLUG đó, bất
kể type; một trang có slug RỖNG là một TEMPLATE — tới bằng URL của entity chứ không có địa
chỉ riêng — nên coi là đã có nếu site có BẤT KỲ trang nào thuộc TYPE đó, vì cái thứ hai chỉ
nằm im sau cái thứ nhất và không ai tới được. Danh sách được kiểm lại khi nó dài thêm, nếu
không hai trang scaffold có thể cùng thấy "chưa có trang nào thuộc type này" đúng trên cùng
một danh sách cũ và cùng được tạo.

**`slug` chỉ được gửi khi khác rỗng.** Gửi `''` là bảo server chiếm lấy slug rỗng, không phải
điều một slug rỗng muốn nói ở đây.

**Một trang hỏng không bao giờ huỷ những trang còn lại.** App đã cài xong trước khi tới bước
tạo trang, nên ném lỗi ở một trang là báo hỏng một lần cài thật ra đã thành công. Trang bị từ
chối nằm trong `failed` kèm lý do, những trang khác vẫn chạy, và cả lệnh gọi lại được an
toàn: cài lần hai là no-op, còn trang đã có thì bị bỏ qua.

Các trang scaffold được đặt tên theo `language`, mặc định `vi`.

**Dry run** đọc danh sách trang — lệnh duy nhất nó gọi — để kế hoạch nói được trang nào đã có
thay vì đoán, rồi trả về `plan` đã sắp thứ tự cùng `present`. **Khi chạy thật** trả về
`installed`, `created`, `present` và `failed` nếu có.

### `action: "global_attach"` / `action: "global_detach"`

Đặt một section dùng chung ĐÃ CÓ lên trang đang mở, hoặc gỡ nó ra. `global_id` gọi tên
master; nếu bỏ trống khi attach, lời từ chối sẽ liệt kê những cái site này có.

**`action:"chrome"` là công cụ sai cho việc này và sẽ đặt hai header lên site.** Cái đó TẠO
một master từ những trang site đã có, đúng cho một site chưa dùng chung gì. Trường hợp thông
thường là site đã có header và trang mới nhất không mang nó — đo trên một storefront thật,
bảy trong hai mươi tư trang không mang cả header lẫn footer trong khi cả hai master đều tồn
tại — và trước action này thì không có công cụ nào cho việc đó.

**Con dấu không bao giờ là thứ người gọi được viết.** Một trang THAM CHIẾU master bằng
`specials.globalRef` + `globalKind`; server compose master lên trang khi đọc và đóng dấu kết
quả là `specials.globalId`. Viết con dấu đã compose làm lần lưu kế tiếp DECOMPOSE node đó đè
lên master và làm rỗng nó cho mọi trang đang mang — bốn trang đã trắng ở đây trước khi
`sb_add` và `sb_set` học cách từ chối, và viết tay tham chiếu là cách duy nhất để gắn. Nên
tham chiếu được viết bởi đoạn mã biết con dấu nào là con dấu nào, còn người gọi không bao
giờ chạm tới con dấu.

Vị trí cũng không phải lựa chọn: header vào ĐẦU và footer vào CUỐI, vì compose biến tham
chiếu thành một band thật và các con của ROOT phải đọc được thành `[header*][middle*][footer*]`
nếu không nền tảng từ chối mọi lần lưu.

**VÀ NỀN TẢNG GHI NHẬN CẠNH THAM CHIẾU CHỈ TỪ CON DẤU ĐÃ COMPOSE, nên gắn cần HAI lần lưu.**
`Decompose` (`server/internal/page/decompose.go:312`) dựng danh sách `GlobalWrite` từ các
node mang `globalId`; node mang `globalRef` — dạng LƯU TRỮ, và là dạng duy nhất client được
viết — rơi vào nhánh `if !stamped { continue }` và không sinh ra write nào.
`SaveDraftComposed` sau đó gọi `SetPageRefs(siteID, pageID, refIDs)` với danh sách không có
nó, mà `SetPageRefs` THAY THẾ toàn bộ tập tham chiếu của trang.

Nên cắm một tham chiếu rồi lưu một lần để lại một trang compose section hoàn toàn đúng ở mọi
lần đọc — Compose phân giải `globalRef` bình thường — trong khi `page_global_refs` không hề
biết. Cái giá là `usageCount` và `GET /global-sections/{id}/pages`, tức danh sách hộp thoại
XOÁ hiển thị: một master báo là đang được 17 trang dùng, bị xoá, và trang thứ 18 trắng. ĐO
ĐƯỢC: gắn header dùng chung vào một trang để `usageCount` nguyên 17 và trang không có trong
danh sách tham chiếu; đọc lại rồi lưu tài liệu đã compose trở lại đưa nó lên 18 và trang xuất
hiện.

`PageSession.recompose` là vòng đi-về đó, và `action:"chrome"` cùng phần gắn chrome của
`sb_page_create` giờ cũng làm — thiếu nó thì mọi trang chúng chạm đều mang chrome của site mà
không trang nào được đếm là có. Nó từ chối chạy khi lần đọc trả về RỖNG, vì lý do `save()`
cũng từ chối: một lần đọc hỏng mở không được phép trở thành một lần ghi làm rỗng trang.

Cả hai action đều báo `pages_referencing` đọc từ nền tảng SAU khi ghi, nên đó là câu trả lời
của chính site chứ không phải ý kiến thứ hai tính ở đây. Gỡ ra không đụng tới master — nó là
bản ghi riêng, còn thứ nằm trong tài liệu trang là một phép compose server thực hiện lúc đọc.

---

## `sb_page_state`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `site_id` | string? | Mặc định `SB_SITE` |
| `page_id` | string? | Mặc định trang đang mở |

**Một trang là BA tài liệu, và mọi trượt câm ở đây đều là hỏi về cái này trong khi cái khác
trả lời:**

| | đọc |
| --- | --- |
| CANVAS editor | bản NHÁP — `GET /pages/{id}/source` |
| STOREFRONT | dòng PUBLISHED, biên dịch lúc publish |
| phiên này | bản sao của nó, đọc một lần rồi sửa từ đó |

"Bản live có dữ liệu mà canvas trắng" chính là hình dạng công cụ này sinh ra để trả lời, và
**đó không phải cache**. Bản nháp đã bị làm rỗng trong khi dòng published vẫn giữ bản tốt.
Repo này có ca đã đo: một product template 24 node đọc về rỗng và bị lưu rỗng; bản published
không hề hấn nên cả 19 trang sản phẩm vẫn hiển thị; không ai thấy cho tới khi có người mở
editor.

**Phán quyết canvas MÔ PHỎNG chính cổng kiểm của editor** thay vì mô tả nó, vì luật chỉ có ba
dòng và không gì khác trả lời được (`editor/src/stores/node.ts`, `hydrate`):

```ts
const nodes = doc?.nodes ?? {};
const rootId = doc?.root_node_id ?? '';
if (!rootId || !nodes[rootId]) { this.seedRoot(opts?.pageId); return; }
```

Tài liệu trượt cổng này bị THAY LẶNG LẼ bằng một ROOT rỗng — canvas trắng, không một dòng
log — và lần lưu kế tiếp của editor ghi cái rỗng đó xuống. Renderer Go không có cổng nào như
vậy, và đó đúng là cách hai bản sao tách nhau ra. Đọc trên tài liệu THÔ, không bao giờ trên
`PageDoc`: `PageDoc.from` sửa alias `rootId` trong bộ nhớ, còn editor đọc đúng byte đã lưu.

Ba phán quyết, và cách chữa khác nhau:

(Và một cảnh báo cho canvas KHÔNG trắng: root không phải `ROOT` — `sppro_1`, `rt_<hex>` từ
seed cũ — qua được cổng này, nhưng editor build trước web_builder `7322af49a` vẽ nó trắng và
có thể tự lưu trang thành rỗng. `canvas.minted_root` nêu tên nó và `canvas.warning` chỉ tới
`sb_page_repair`.)

- **alias `rootId`** — chữa được trong một lần lưu, và được gọi tên riêng vì nếu không người
  đọc chẳng hiểu vì sao một tài liệu đầy node lại sắp biến mất. Đây là hình dạng
  `editor/src/element/completionPage.ts:91` từng ship trước `8e40bbab`.
- **root không trỏ tới node nào** — cái nguy hiểm, và lời khuyên đảo ngược: ĐỪNG mở trang này
  trong editor, vì chính lần lưu đó biến mất mát thành vĩnh viễn. Phục hồi từ một version.
- **không có node nào** — bình thường với một trang vừa tạo.

`drift` so `updatedAt` của bản nháp với `publishedAt` của dòng live, chừa một giây dung sai vì
publish ghi dòng của nó sau khi đọc bản nháp. `published_ahead` được báo đúng như cái nó là —
LAN từ một header dùng chung sửa ở nơi khác — chứ không phải một lỗi.

`recovery` LIỆT KÊ các điểm phục hồi thật thay vì mô tả chúng, rút gọn còn id / nhãn / thời
điểm vì một version của trang hai node đo được 1.690 byte và danh sách hai mươi bản thật là
1,4 MB. Nền tảng thêm một checkpoint autosave ở MỌI lần lưu nháp và đúc một snapshot có nhãn
khi được yêu cầu, nên **checkpoint trước một lần PUT toàn tài liệu đã được lấy sẵn**; một lần
restore chỉ đổi bản NHÁP, và nền tảng tự ghi một version `__pre_restore` trước, nên restore
cũng hoàn tác được.

`editor_note` nêu mốc thời gian của bản nháp và ý nghĩa của nó: một tab editor mở trước mốc
đó đang giữ bản cũ, vì editor nạp bản nháp một lần và không đọc lại — nên một lần lưu từ đây
là vô hình ở đó cho tới khi tab được tải lại, và lần lưu kế tiếp của tab đó sẽ ghi bản cũ của
nó đè lên bản này.

## `sb_undo`

Trả lại thứ mà một lệnh `PUT` qua `sb_api_call` đã ghi đè.

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `index` | number? | 1 là lần ghi gần nhất. Bỏ trống để **liệt kê** những gì hoàn tác được |
| `dry_run` | boolean? | Mặc định **true** |

Mọi lệnh thay-toàn-bộ-tài-liệu mà server này có thể gửi đều là một chiều: `PUT /settings`
không phải patch, body thiếu trường là xoá cấu hình cửa hàng; `PUT .../forms/{id}/document`
thay toàn bộ trường của trang thanh toán; `PUT .../pages/{id}/source` thay cả trang. Người bán
bấm trong editor thì có undo. Agent thì không có gì, mà một lệnh của nó phá được nhiều hơn.

**VỚI MỘT TRANG, ĐÂY LÀ ĐƯỜNG VỀ THỨ HAI CHỨ KHÔNG PHẢI DUY NHẤT — và trang này đã nói ngược
lại suốt ba giai đoạn.** Nó từng viết "nền tảng không có lịch sử trang, không có version,
không có restore", điều đó đúng với tài liệu OpenAPI và sai với nền tảng: `saveDraftRaw` ghi
một checkpoint tự động ở mỗi lần lưu nháp, `SaveVersion` tạo một bản chụp có nhãn, và cả hai
đều khôi phục được. Chúng không có dòng `@Router` nào, nên tới được trình duyệt mà không tới
được gì khác — giờ đã được chú thích và có trên call sheet (`sb_api_find "page versions"`).
Khi thứ bị hỏng là một trang thì hãy dùng chúng trước: chúng là của chính nền tảng và sống
lâu hơn mọi thứ, còn nhật ký bên dưới nằm trong tiến trình này và chết cùng nó. RESTORE LÀM
ĐỔI BẢN NHÁP, nên nhớ publish sau đó. Xoá một trang thì vẫn là một chiều.

**Vì vậy một PUT sẽ đọc trước khi ghi.** PUT theo định nghĩa là thay thế, nên thứ nó sắp phá
chính là thứ lệnh GET tương ứng trả về — thêm đúng một round trip trên lệnh ghi, không có
trên lệnh đọc và không có trên dry run. Nó im lặng khi thất bại: một undo không chuẩn bị được
thì không được phép chặn lệnh ghi mà người gọi đã yêu cầu, và một PUT dùng để tạo mới thì
chẳng có gì để đọc.

Khi khôi phục, lệnh đi lại qua **đúng operation cũ**, chỉ mang những trường mà handler của
operation đó decode — không phải cả response GET, vốn chứa các cột định danh và cột dẫn xuất
thuộc về nền tảng. Envelope không đồng nhất, nên các tên trường đó được tìm ở tầng trên cùng
trước, rồi mới tìm bên trong một envelope một-khoá nếu tầng trên không có:
`{ document: … }` **chính là** body mà `PUT .../document` cần, còn `{ source: … }` giữ
`document` và `schemaVersion` ở một tầng sâu hơn. Envelope lạ thì không ghi nhận gì, thay vì
đoán.

Một mục bị **xoá ngay sau khi được trả lại**, để undo là một bước lùi chứ không phải vòng lặp
giữa hai trạng thái.

**Nằm trong tiến trình, không nằm trên đĩa**, và giới hạn 20 mục. Server này chỉ giữ tài liệu
và ảnh chụp; một thư mục snapshot là một loại tài sản mới phải sở hữu, kèm câu hỏi về thời
hạn lưu và câu hỏi về riêng tư. Khoảng thời gian thật sự quan trọng là lúc người ta với tay
tới undo — agent phát hiện hỏng hóc ngay trong phiên đã gây ra nó.
