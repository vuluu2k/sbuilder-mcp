# Bộ tool

Bốn tool với tới 310 operation của nền tảng. `sb_api_find` là một chỉ mục, không phải mỗi
endpoint một tool — [lý do](../README.vi.md#bộ-tool).

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

Tìm operation theo ý định.

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `query` | string | Bạn muốn làm gì, viết bằng lời |
| `tag` | string? | Thu hẹp theo một tag: `menus`, `products`, `theme`, … |
| `limit` | number? | Mặc định 12, tối đa 50 |

Mỗi kết quả trả về id, method, path, tóm tắt, tag, credential cần dùng, và các tham số
không phải body — kèm **đúng một** phán quyết về body:

| Trường | Nghĩa |
| --- | --- |
| `body_schema` | Tài liệu giải được `$ref`; đây là hình dạng thật |
| `body_warning` | Có khai báo body nhưng không có schema (58 operation). Hãy đọc GET tương ứng rồi sửa một bản sao |
| `body_note` | Operation ghi mà **không** khai báo body nào (60 operation). Đôi khi đúng — `POST /orgs/{id}/leave` là một hành động thuần — đôi khi chỉ là thiếu annotation: `PUT /pages/{id}/source` mang cả một tài liệu trang và được ghi chú y hệt như vậy |

Không bao giờ có quá một trong ba. Phân biệt này là chịu lực: coi `body_note` là "không
nhận body" sẽ gửi một PUT rỗng và xoá trắng một trang.

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
section và site overlay đã được gộp lên ROOT.

## `sb_outline`

`depth` (1–6, mặc định 1). Mỗi node một dòng: `id`, `type`, `name`, `children`, kèm `band`
(`header`/`middle`/`footer`), `global: true` nếu là master dùng chung, `overlay: true` nếu
là site overlay. **Không bao giờ trả tài liệu thô** — một trang thật nặng hàng trăm KB.

## `sb_node_read`

`id`. Một node đầy đủ. Kèm `warning` nếu node đó là global dùng chung.

## `sb_catalog_search`

`query`, `limit`. Tìm trong chính AI hints của nền tảng trên cả 85 element, trả về
`description`, `useWhen`, `avoidWhen`, `contentTips` cho mỗi kết quả — do đội nền tảng viết
đúng cho mục đích này.

## `sb_traits_for`

`type`. Element nhận những **nhóm** trait nào (`size`, `typography`, `background`,
`spacing` …), default được gieo sẵn, và luật chứa con.

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

**Style và config mặc định ghi theo breakpoint.** Một đại lượng thị giác ghi ở base sẽ hiện
đúng trên canvas rồi biến mất lúc publish — cascade đã publish không có lớp base nào đỡ.
`base: true` bị từ chối với mọi key không phải key định danh (`htmlTag`, `kind`, `href`,
`src`, `alt`, …). `specials` luôn ở base: nội dung không phải đại lượng.

## `sb_move` / `sb_remove`

`sb_move` nhận `id`, `parent_id`, `index`. `sb_remove` nhận `id` và xoá cả cây con. Cả hai
từ chối đụng vào **site overlay** — nó được ghép lên ROOT lúc đọc và bóc ra lúc ghi, nên sửa
ở đây lúc lưu sẽ không có tác dụng gì. `sb_move` từ chối chuyển node vào chính hậu duệ của
nó, việc sẽ tách rời cây con đó mà không báo gì.

## Mỗi lần ghi kiểm tra gì trước khi lưu

Bốn luật của nền tảng, được viết thành code có test chứ không phải ghi chú:

1. **Thứ tự băng** — con của ROOT phải đọc `[header][middle][footer]`. Sai là nền tảng từ
   chối *mọi* lần lưu (`ErrBandOrder`).
2. **Overlay** bị loại khỏi mọi luật cấp ROOT, đúng như nền tảng loại nó trước khi tự kiểm.
3. **Global** là master dùng chung; mọi kết quả đụng tới nó đều kèm cảnh báo rằng sửa nó là
   sửa mọi trang, và publish thì lan.
4. **Luật responsive** — xem `sb_set` ở trên.

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

**Lưu trước**, rồi mint link preview đã ký và render trang bằng chính renderer Go của nền
tảng — nên bức ảnh là của *bản nháp đã lưu*, không bao giờ là của sửa đổi chưa lưu. Trả về
một ảnh mỗi bề rộng, kèm bounding box đo được của từng `[data-node-id]`.

Cần **Google Chrome của hệ thống**: `playwright-core` không kèm trình duyệt nào nên lúc cài
không tải gì. Nếu thiếu Chrome, tool nói đích danh chứ không trả ảnh trắng — một agent đi
chấm bức trang nó chưa từng nhìn thấy còn tệ hơn một agent chịu dừng.

## `sb_bind`

| Tham số | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | string | |
| `source` | string | Một trong 22 khoá renderer cung cấp — `product.title`, `product.price`, `category.title`, `article.title`, … |
| `field` | string | Luôn là `specials.<key>` |
| `dry_run` | boolean? | Mặc định true |

Cả hai tham số đều được kiểm với từ vựng sinh tự động, vì cả hai lỗi đều **im lặng**:
`source` lạ sẽ giải ra rỗng và hiện placeholder của chính element (không phân biệt được với
"đang tải"), còn `field` ngoài `specials` thì được lưu, được ghi, được publish, và bị bỏ qua
mãi mãi — `applyBindings` đọc namespace từ field rồi bỏ qua mọi thứ khác.

---

# Thiết kế như người thật

## `sb_traits_for` — inspector, không phải bản tóm tắt

Trả về inspector của element đúng như người ta nhìn: **tab → nhóm → control**, và mỗi
control ghi vào đâu nếu nền tảng có khai báo.

```
[general] Typography: text_color, font_family, font_size, text_align, line_height, …
font_size → ghi style.fontSize, kiểu number, đơn vị px, mặc định { base: 16, mobile: 14 }
```

83 trên 372 control có đích ghi khai báo sẵn. Số còn lại trả về **có tên nhưng không mô
tả**, kèm lý do — ràng buộc của chúng dựng bên trong widget Vue, máy không đọc được. Với
những cái đó, hãy đọc một node đã dùng control ấy (`sb_node_read`), hoặc set thẳng thuộc
tính CSS.

**`style` là CSS mở.** Mọi khoá camelCase đều thành một thuộc tính CSS, nên bạn set được
bất cứ thứ gì CSS diễn đạt được, dù có control cho nó hay không. `config` và `specials`
thì **không** mở — chúng theo từng element, và `defaults` của element nói đúng những khoá
nó thật sự dùng.

## `sb_duplicate`

`id`. Nhân bản node và cả cây con dưới **id mới**, chèn ngay sau bản gốc — thao tác người
thiết kế làm liên tục. Style đi theo, và đó chính là mục đích. Từ chối ROOT và site overlay.

## `sb_templates` / `sb_template_use`

`sb_templates` liệt kê section template đã lưu. `sb_template_use` thả một cái vào trang —
server tự copy, nên section tới đúng như lúc được thiết kế. Nhớ mở lại trang sau đó; phiên
đang mở vẫn giữ cây cũ.

## `sb_page_list` / `sb_page_create` / `sb_publish`

Vòng đời trang, thành tool hạng nhất thay vì đi vòng qua `sb_api_call`. Trang mới tạo thì
rỗng, và `sb_page_open` gieo ROOT cho nó.

`sb_publish` **lan**: trang dùng chung global section với trang khác sẽ publish luôn các
trang đó, vì header sửa một lần không được lên live ở trang này mà cũ ở trang kia.

## Hover và các trạng thái khác

`sb_set` nhận `state` — `hover` là cái inspector có. Trạng thái lồng *dưới* breakpoint chứ
không thay thế nó, nên vẫn ghi theo breakpoint như mọi đại lượng thị giác, không bao giờ ở
base.
