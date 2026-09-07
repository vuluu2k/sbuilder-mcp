# Bộ tool

Bốn tool với tới 412 operation của nền tảng. `sb_api_find` là một chỉ mục, không phải mỗi
endpoint một tool — [lý do](../README.vi.md#bộ-tool).

Mọi kết quả đều là **JSON nén** — không thụt lề, vì người đọc là model và khoảng trắng chiếm
15 % mỗi câu trả lời. Một directive (`findings_notice`, `layout_notice`, `note`,
`boxes_format`) chỉ nói **một lần mỗi process**, sau đó trường ấy đơn giản là vắng mặt: một
chỉ dẫn lặp lại ở mọi lần gọi thì tới lần thứ ba là bị đọc lướt. Mọi tool đều mang MCP
annotation — `readOnlyHint` trên mười hai tool chỉ đọc, `destructiveHint` trên `sb_remove`,
`sb_api_call` và `sb_publish` — nên client nào tôn trọng chúng sẽ thôi hỏi người dùng xác
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

**Call sheet** (`id`) trả về operation đầy đủ — `params` có kiểu, `tags`, `credential` —
kèm **đúng một** phán quyết về body:

| Trường | Nghĩa |
| --- | --- |
| `body_schema` | Tài liệu giải được `$ref`; đây là hình dạng thật |
| `body_warning` | Có khai báo body nhưng không có schema (62 trên 168 operation mang body). Hãy đọc GET tương ứng rồi sửa một bản sao |
| `body_note` | Operation ghi mà **không** khai báo body nào (95 trên 180 operation ghi). Đôi khi đúng — `POST /orgs/{id}/leave` là một hành động thuần — đôi khi chỉ là thiếu annotation: `PUT /pages/{id}/source` mang cả một tài liệu trang và được ghi chú y hệt như vậy |

Không bao giờ có quá một trong ba. Phân biệt này là chịu lực: coi `body_note` là "không
nhận body" sẽ gửi một PUT rỗng và xoá trắng một trang. Nó không đổi so với hồi còn đi kèm
mọi kết quả; giờ nó tới đúng lúc agent đã chọn xong operation, tức là lúc nó được đọc.

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

Credential chọn theo path chứ không theo tham số: `/api/v1/…` dùng `SB_TOKEN`, còn lại
dùng phiên. Thiếu `SB_TOKEN` thì báo đích danh tên biến, thay vì để nền tảng trả
`401 api_key_required` — cái đó đọc lên giống lỗi phân quyền.

Một lệnh gọi thất bại mang đúng một hình dạng lỗi của nền tảng, `{ error, code }`, và — khi
nền tảng gửi kèm — `details` và `fields`. Lỗi `validation` nêu đích danh trường sai trong
thông điệp, nên một 400 nói rõ *trường nào* chứ không chỉ nói là có một trường sai.

---

# Bộ tool cho trang

Chín tool nữa để thiết kế chính trang đó. `sb_page_open` phải gọi trước; các tool còn lại
thao tác trên đúng một tài liệu đang mở.

## `sb_page_open`

| Tham số | Kiểu |
| --- | --- |
| `site_id` | string |
| `page_id` | string |

Nạp tài liệu **bản nháp** của trang và trả về outline. Thứ nhận được đã *ghép sẵn*: global
section, site overlay và app block đã được gộp lên ROOT. Findings đi kèm, đúng hình dạng
`sb_review` trả về — xem bên dưới.

## `sb_outline`

`depth` (1–6, mặc định 1). Mỗi node một dòng: `id`, `type`, `name`, `children`, kèm `band`
(`header`/`middle`/`footer`), `global: true` nếu là master dùng chung, `overlay: true` nếu
là site overlay, và `app: true` nếu là gốc của một app block đã ghép — không sửa được gì
bên dưới nó. **Không bao giờ trả tài liệu thô** — một trang thật nặng hàng trăm KB.

## `sb_node_read`

`id`. Một node đầy đủ. Kèm `warning` nếu node đó là global dùng chung.

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

## `sb_set`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | string | |
| `namespace` | `style` \| `config` \| `specials` | |
| `keys` | object | |
| `breakpoint` | `desktop` \| `laptop` \| `tablet` \| `mobile` | Mặc định `desktop` |
| `base` | boolean? | Ghi ở base thay vì theo breakpoint |
| `dry_run` | boolean? | Mặc định true |

**Base và breakpoint.** `sb_set` mặc định ghi theo breakpoint, vì một thiết kế nên đáp ứng. Base cũng hợp lệ — cascade giải một khoá theo thứ tự *slot hiện tại → rộng hơn → base → hẹp hơn*, nên base là lớp dự phòng, và là chỗ default của chính mỗi element được gieo vào. Dùng base cho giá trị thật sự không nên thay đổi.

`specials` luôn ở base: nội dung không phải đại lượng.

Chạy khô trả về `patches` và, lần đầu trong một process, một `note` nhắc lại luật base và
breakpoint ở trên. Ghi thật trả về các khoá đã set và `rev` mới, kèm `warning` nếu node là
global dùng chung.

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

**Lưu trước**, rồi mint link preview đã ký và render trang bằng chính renderer Go của nền
tảng — nên bức ảnh là của *bản nháp đã lưu*, không bao giờ là của sửa đổi chưa lưu. Trả về
một ảnh mỗi bề rộng, kèm `boxes`: một mảng các bộ `[id, type, x, y, w, h]` tính bằng CSS px
ở `widths[0]`, cho các node tới `box_depth` trong tài liệu đang mở — mặc định 2 là các băng
và con trực tiếp của chúng, đúng thứ một nhận định bố cục cần; ROOT luôn được giữ. Chú giải
một dòng `boxes_format` đi kèm lần look đầu tiên trong một process. Mọi `[data-node-id]` vẫn
được đo và giữ trong phiên cho con trỏ hiện diện và các kiểm tra bố cục; hai trăm object in
đẹp từng tốn 27 KB mỗi lần look. `with_boxes: false` bỏ chúng đi. Findings đi kèm như với
`sb_review`, và lỗi bố cục đi kèm dưới `layout` — xem cuối tài liệu này.

Cần **Google Chrome của hệ thống**: `playwright-core` không kèm trình duyệt nào nên lúc cài
không tải gì. Nếu thiếu Chrome, tool nói đích danh chứ không trả ảnh trắng — một agent đi
chấm bức trang nó chưa từng nhìn thấy còn tệ hơn một agent chịu dừng.

## `sb_bind`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | string | |
| `source` | string | Một trong 26 khoá renderer cung cấp — `product.title`, `product.price`, `category.title`, `article.title`, … |
| `field` | string | Luôn là `specials.<key>` |
| `dry_run` | boolean? | Mặc định true |

Cả hai tham số đều được kiểm với từ vựng sinh tự động, vì cả hai lỗi đều **im lặng**:
`source` lạ sẽ giải ra rỗng và hiện placeholder của chính element (không phân biệt được với
"đang tải"), còn `field` ngoài `specials` thì được lưu, được ghi, được publish, và bị bỏ qua
mãi mãi — `applyBindings` đọc namespace từ field rồi bỏ qua mọi thứ khác.

---

# Thiết kế như người thật

## `sb_traits_for` — inspector, không phải bản tóm tắt

Trả về inspector của element đúng như người ta nhìn — **tab → nhóm → tên control** — và,
với mỗi control nền tảng có khai báo, nó ghi vào đâu:

```
{ type, hints: { useWhen, avoidWhen, contentTips },
  inspector: [{ tab, groups: [{ group, controls: ["font_size", …] }] }],
  declared: { font_size: { label, writes, defaults? }, … },
  defaults, isContainer, isRootOnly, childAllows,
  undeclared_note, style_is_open_css }
```

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
thiết kế làm liên tục. Style đi theo, và đó chính là mục đích. Từ chối ROOT và site overlay.

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

`sb_publish` **lan**: trang dùng chung global section với trang khác sẽ publish luôn các
trang đó, vì header sửa một lần không được lên live ở trang này mà cũ ở trang kia.

## Hover và các trạng thái khác

`sb_set` nhận `state` — `hover` là cái inspector có. Trạng thái lồng *dưới* breakpoint chứ
không thay thế nó, nên vẫn ghi theo breakpoint như mọi đại lượng thị giác, không bao giờ ở
base.

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
| `dead_binding_source` | Nguồn renderer không cung cấp — hiện placeholder mãi mãi |
| `dead_binding_field` | Field binding ngoài `specials` — được lưu, được publish, và bị bỏ qua |
| `unknown_element` | Type catalog không biết; chạy `npm run codegen` |

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
