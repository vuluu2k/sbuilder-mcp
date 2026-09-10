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
tới khi có một trang loại đó ĐƯỢC PUBLISH. Mặc định là `page`. Thiếu tham số này thì agent có
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
`{ id, method, path, summary, credential, params, body? }`. `params` liệt kê tên các tham số
không phải body, tham số tuỳ chọn có tiền tố `?` (`["siteID", "?limit"]`); `body` là một từ
— `described`, `undescribed` hoặc `none_declared` — và vắng mặt với operation đọc. Không có
tag, không có schema: mười hai kết quả kèm schema inline từng đo được 44 KB, cho một danh
sách mà agent chỉ gọi đúng một mục. `next` nhắc truyền một id lại để lấy call sheet.

**Call sheet** (`id`) trả về operation đầy đủ — `params` có kiểu, `tags`, `credential` — kèm
**một** kết luận về body:

| Trường | Nghĩa |
| --- | --- |
| `body_shape` | Các trường handler thật sự decode, đọc từ mã nguồn Go của nền tảng: `{ fields: [{ name, type, note? }], readOnly?, goType, source: "go" }`. Phủ 158 trong 212 write operation |
| `body_schema` | Swagger giải được `$ref` và không tìm thấy shape từ handler |
| `body_warning` | Có khai báo body nhưng không gì mô tả hình dạng. Hãy đọc GET tương ứng rồi sửa một bản sao |
| `body_note` | Operation ghi mà **không** khai báo body nào. Đôi khi đúng — `POST /orgs/{id}/leave` là một hành động thuần — đôi khi chỉ là thiếu annotation |

Không bao giờ có quá một trong bốn, và `body_shape` được ưu tiên trước. Ưu tiên vì handler là
mã thật sự chạy: `swagger.json` mô tả 46 trong 212 write body, và nó gắn `@Param body` của
một khối doc comment cho **mọi** dòng `@Router` bên dưới, nên một GET danh sách có thể nhận
là có body mà nó không nhận. Điểm decode thì nằm gọn trong đúng một `case http.Method*`.

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

## `sb_api_call`

Chạy một operation tìm được bằng `sb_api_find`.

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | string | Lấy từ `sb_api_find`, ví dụ `get:/api/sites/{siteID}/menus` |
| `path_params` | object? | Mọi `{name}` trong path; thiếu một cái là bị từ chối, giá trị được URL-encode |
| `query` | object? | Query string; giá trị `undefined` bị bỏ |
| `body` | any? | Thân yêu cầu |
| `dry_run` | boolean? | **Mặc định `true`** — không gửi gì, trả về bản xem trước đã che bí mật |
| `pick` | string[]? | Các field giữ lại trên mỗi item của một câu trả lời dạng danh sách (hoặc trên item duy nhất của câu trả lời `{ page: {…} }`) |
| `max_items` | number? | Trần số item của một danh sách, áp sau phân trang của chính nền tảng |

Credential chọn theo path chứ không theo tham số: `/api/v1/…` dùng `SB_TOKEN`, còn lại
dùng phiên. Thiếu `SB_TOKEN` thì báo đích danh tên biến, thay vì để nền tảng trả
`401 api_key_required` — cái đó đọc lên giống lỗi phân quyền.

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

Ba luật lặng lẽ hơn, mỗi luật tồn tại vì phương án còn lại làm mất dữ liệu mà không nói. Một
câu trả lời **không có danh sách duy nhất** — ví dụ hai mảng — được trả về nguyên vẹn kèm
`shaping_note`, thay vì bị định hình thành thứ nền tảng chưa từng gửi; `pick` không khớp
trường nào cũng vậy, vì `{}` đọc lên như "nền tảng không trả gì". Nếu chính câu trả lời của
nền tảng đã có trường `truncated`, thông tin cắt sẽ nằm ở `_truncated` chứ không ghi đè. Và
khi riêng phần không phải danh sách đã vượt trần, không cắt gì cả — bỏ bớt item cũng không
giúp — và ghi chú nói rõ vì sao.

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
— nó vứt bản của mình, kéo lại từ server, và **để lần lưu kế tiếp báo lỗi to** để người gọi
đọc lại rồi làm lại. An toàn khi chạy cạnh người thật; người thật thắng mọi bất đồng.

## `sb_look`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `widths` | number[]? | Mặc định 1440 / 768 / 390 |
| `with_boxes` | boolean? | Mặc định true |
| `box_depth` | number? | Box cho các node tới độ sâu này trong cây. Mặc định 2, tối đa 8 |
| `node_id` | string? | Chỉ đóng khung element này thay vì cả trang |
| `format` | `"jpeg"` \| `"png"`? | `jpeg` (mặc định) nhỏ hơn và nhanh hơn; `png` khi cần màu chính xác từng pixel |

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

---

## `sb_bind`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | string | |
| `source` | string | Một trong 77 khoá mà hai bộ render cung cấp — `product.title`, `product.price`, `category.title`, `course.title`, `site.*`, … Schema chỉ nêu bốn cái; sai một khoá thì bị từ chối kèm danh sách đầy đủ, nhờ vậy danh sách tool vẫn gọn |
| `field` | string | Luôn là `specials.<key>` |
| `dry_run` | boolean? | Mặc định true |
| `action` | `"add_to_cart"` \| `"buy_now"`? | Biến node thành nút MUA HÀNG thay vì một trường dữ liệu |

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
  defaults, translatable?, config_values?, isContainer, isRootOnly, childAllows,
  undeclared_note, style_is_open_css }
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
giỏ, Mua ngay) đã bind sẵn, kèm BINDING `add_to_cart` — thứ khó đoán nhất. Truyền `seed:false`
nếu muốn trang trắng. `locale` (mặc định `vi`, hoặc `en`) và `headline` chọn câu cảm ơn của trang
complete, đọc từ i18n của nền tảng để cửa hàng tiếng Việt không mở ra bằng tiếng Anh. Seed là lệnh
ghi THỨ HAI: nếu nó hỏng thì trang vẫn được tạo và đang trắng, kết quả nói rõ điều đó chứ không
làm hỏng cả lệnh tạo.

`sb_publish` **lan**: trang dùng chung global section với trang khác sẽ publish luôn các
trang đó, vì header sửa một lần không được lên live ở trang này mà cũ ở trang kia.

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
| `categoryScope` | Từ hai danh mục sản phẩm trở lên mà không cái nào trỏ tới trang riêng, nên `/collections/{slug}` phục vụ chung một default template — và không gì trên đó thu hẹp feed sản phẩm theo danh mục trong URL. Khách bấm một danh mục thấy toàn bộ catalogue. Danh mục blog tự thu hẹp theo slug, cái này thì không |

Mỗi khoảng trống mang `draft: true` khi trang ĐÃ CÓ nhưng chưa publish, vì "publish cái đã
làm" và "tạo mới" là hai việc khác nhau. Sắp theo mức chặn giảm dần.

Bốn lệnh GET phụ trả giá cho việc này (pages, payment-gateways, shipping-methods,
global-sections) và không cái nào làm hỏng được review: một lệnh thất bại thì luật đó **im
lặng** thay vì báo một khoảng trống cửa hàng có thể không có. Một cảnh báo nổ trên cửa hàng
đúng là cảnh báo người ta học cách bỏ qua.

## `sb_media_list` / `sb_media_upload`

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
| `max_nodes` | number? | Mặc định 300 — trần cho toàn bộ lần import |
| `upload_images` | boolean? | Chép ảnh vào media library của site, mặc định **true** |
| `dry_run` | boolean? | Mặc định **true** — trả về những gì tìm thấy |

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

**Ảnh được chép về, không hotlink.** Mỗi ảnh được upload vào media library của site và node
trỏ vào bản chép; ảnh nào upload hỏng thì giữ URL gốc, vì một tấm ảnh hiện được vẫn hơn một
khung trống. Truyền `upload_images: false` để bỏ qua.

**Nội dung rơi vào TRONG dải giữa** — trước global footer đầu tiên, sau header. Nối thêm vào
cuối ROOT là cách hiển nhiên và nó phá bẫy 3 trên mọi trang có global footer: nền tảng từ chối
cả lần lưu, còn người gọi thì bị báo về một luật dải mà họ không hề cố ý vi phạm.

Trang tự dựng bằng script sau khi load, hoặc trang sau đăng nhập, sẽ đọc ra mỏng hoặc rỗng —
kết quả nói rõ đã bỏ qua những gì và vì sao.

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
| `max_nodes` | number? | Mỗi trang, mặc định 300 |
| `upload_images` | boolean? | Mặc định **true** |
| `homepage` | boolean? | URL vào rơi vào trang chủ sẵn có của site này, mặc định **true** |
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

**Ảnh upload một lần cho cả lượt import.** Logo, dải phương thức thanh toán, huy hiệu ở footer
xuất hiện trên mọi trang của một website thật; upload theo từng trang sẽ nhét vào media library
của merchant mười hai bản mỗi thứ.

**Không publish gì cả, và ba việc lần import không làm hộ bạn.** Header và footer của trang
nguồn bị bỏ có chủ đích — site này có header/footer riêng dạng global, và một menu thứ hai trỏ
sang website người khác còn tệ hơn là không có. Không có menu nào nối các trang mới lại với
nhau. Và chưa có gì được nhìn ở 390px. `sb_look` từng trang ở ba khổ, rồi mới `sb_publish`.

## `sb_store`

Chạy một luồng cửa hàng bắt buộc **đúng thứ tự**.

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `action` | `"checkout"` \| `"form"` | Luồng cần chạy |
| `site_id` | string? | Không truyền thì lấy `SB_SITE` |
| `language` | `"vi"` \| `"en"`? | `checkout` — ngôn ngữ nội dung, mặc định `vi` |
| `page_name` | string? | `checkout` — ghi đè tên trang mặc định của editor |
| `headline` | string? | `checkout` — ghi đè tiêu đề trang |
| `template` | enum? | `form` — chọn một trong 17 template của nền tảng |
| `name` | string? | `form` — tên form trong danh sách của chủ shop |
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

Nó **không tạo trang**. Đặt form ở đâu là quyết định thiết kế, và `/account` là trang duy
nhất không được tự do chọn: `membersOnlyRedirectTarget` đưa mọi khách bị chặn về đó. Đặt form
bằng `sb_add` rồi trỏ `specials.formId` vào id nó trả về.

### `action: "checkout"`

`sb_review` nêu tám readiness gap. Bảy cái giờ chỉ còn một lệnh gọi mỗi cái — một phương thức
giao hàng, một cổng thanh toán, một sản phẩm, một trang đúng type — vì call sheet đã nói rõ
những lệnh đó nhận gì. Checkout là cái còn lại, vì nó là **bốn lệnh ghi mà thứ tự chính là
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

## `sb_undo`

Trả lại thứ mà một lệnh `PUT` qua `sb_api_call` đã ghi đè.

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `index` | number? | 1 là lần ghi gần nhất. Bỏ trống để **liệt kê** những gì hoàn tác được |
| `dry_run` | boolean? | Mặc định **true** |

Nền tảng không có lịch sử trang, không có version, không có restore — `restore` duy nhất
trong `/api/v1` là `media/{id}/restore`. Nên mọi lệnh thay-toàn-bộ-tài-liệu mà server này có
thể gửi đều là một chiều: `PUT /settings` không phải patch, body thiếu trường là xoá cấu hình
cửa hàng; `PUT .../forms/{id}/document` thay toàn bộ trường của trang thanh toán;
`PUT .../pages/{id}/source` thay cả trang. Người bán bấm trong editor thì có undo. Agent thì
không có gì, mà một lệnh của nó phá được nhiều hơn.

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
