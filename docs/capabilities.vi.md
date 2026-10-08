# Khả năng — builder thực sự hỗ trợ gì

*[English](./capabilities.md)*

Những gì một agent dựng được từ **element native** qua server này, mỗi khả năng nằm ở đâu trong
nền tảng, và nó dừng ở đâu. Mỗi dòng đều đọc từ source (đường dẫn tính từ repo `web_builder`, ở
commit mà catalog được sinh ra); dòng ghi *chưa có* là nền tảng chưa có, không phải server này
giấu đi.

Quy tắc mà trang này tồn tại để nói: **ghép element native trước; chỉ dùng `custom-code` cho một
khoảng trống được nêu tên ở đây.** Element native vẫn chọn và sửa được trong visual editor; một
khối HTML trong `custom-code` thì không, và `sb_review` không nhìn vào bên trong nó được.

## Quy trình

1. **Khám phá** — `sb_catalog_search` với điều bạn cần (`"pagination"`, `"sort"`, `"popup"`),
   hoặc đúng type (`"list-dataset"`). Trùng type và tên được xếp đầu.
2. **Đọc schema** — `sb_traits_for <type>`: mọi control của inspector, key và namespace nó ghi,
   default theo breakpoint, giá trị cho phép, key nào chỉ đọc ở base, specials nào binding được
   nhắm tới, và element nhận những event nào.
3. **Ghép** — mỗi section một lệnh `sb_add` lồng nhau; rồi `sb_set`, `sb_bind`, `sb_event`. Mọi
   lệnh ghi mặc định `dry_run: true`, và dry run chạy đúng bước kiểm tra của lần lưu thật.
4. **Xem và review** — `sb_look` (bản render của chính nền tảng ở ba bề rộng, kèm lỗi bố cục đo
   được) và `sb_review` (những gì tài liệu không làm được lúc chạy).
5. **Custom code sau cùng** — chỉ cho một khoảng trống trong bảng dưới, và nói rõ là cái nào.

## Bảng khả năng

| Khả năng | Nằm ở (nền tảng) | Editor | MCP | Runtime | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| Container, bố cục, style responsive | `schema/src/node.ts` (`style`, `responsive.{tablet,mobile}`) | các panel style | `sb_set` theo breakpoint, `base_only` trong `sb_traits_for` | CSS của renderer Go (`server/render/css.go`) | đủ |
| Repeater với item template sửa được | `list-dataset` (`config.datasetSource`, `config.kind`) | con là node bình thường | `sb_add` gieo sẵn binding; `sb_review extra_repeater_child` | `server/render/nodes/list-dataset/html.go` | đủ — sáu nguồn: product, category, article, blogCategory, course, review |
| Bind text / ảnh / link / input | `node.bindings` → `specials.*` (`schema/src/binding.ts`) | `BindingControl.vue` | `sb_bind` (field kiểm tra theo specials bind được của element) | `server/render/scope/scope.go` ApplyBindings | đủ; `binding.transform` được khai báo nhưng không renderer nào đọc |
| Tìm kiếm | `search-input`; LIST có thể từ chối bằng `specials.searchable: false` (vắng = có) | có | `sb_add` + `sb_set` | `runtime/src/nodes/search-input.ts`, đồng bộ URL | đủ |
| Lọc | `filter-checkbox`, `filter-radio`, `filter-color`, `filter-slider`, `filter-tag` (`specials.filterSource`); list từ chối bằng `specials.filterable: false` | có | có | `runtime/src/core/filterUrl.ts` (tham số `f.`), soft swap `filterSwap.ts` | đủ, đồng bộ URL |
| Sắp xếp | **`select` với `specials.filterSource: "sort"`** — không phải element riêng | có | có | `filterUrl.ts` (tham số `s.`); sáu key: newest, oldest, price_asc, price_desc, name_asc, name_desc | đủ |
| Phân trang / tải thêm / cuộn vô hạn | **`list-dataset config.loadingMode`**: none, pagination, load_more, scroll_more | có | có | `runtime/src/nodes/list-paging.ts`, `p.<nodeId>` | đủ |
| Trạng thái rỗng | satellite `list-empty` qua `config.emptyStateId` | editor gieo sẵn | `sb_add` gieo qua đường satellite | `list-dataset/html.go` | đủ |
| Trạng thái đang tải | `list-loading` (tuỳ chọn) | có | có | hiện khi filter swap | một phần — không có trạng thái *lỗi* thiết kế được; swap lỗi thì điều hướng lại cả trang |
| Ẩn/hiện | `config.hidden` theo breakpoint; `member-gate` (`specials.audience` members/guests) | có | có | `css.go` hiddenAt; `runtime/src/nodes/member-gate.ts` | một phần — chưa có ẩn/hiện theo dữ liệu hay state trên node thường |
| Action | `schema/src/actions/enum.ts` (21 action; trigger click, form submit/success/error) | `ActionRow.vue` | `sb_event` (danh sách cho phép theo element trong `sb_traits_for`; payload được kiểm tra) | dispatch ở `runtime/src/core/boot.ts` | đủ với các action có trong danh sách; add_to_cart / buy_now là BINDING, không phải event |
| Popup | `popup` trong `site_overlays`, mở bằng action `popup` với `payload.id` (overlay id) | có | overlay qua `sb_store` + `sb_event` | `runtime/src/nodes/popup-control.ts` | một phần — popup không nhận context của item; chỉ `quickview` (sản phẩm) có. Lý do đo được: `wbState` chỉ gieo id + biến thể sản phẩm (`server/render/scope/seed.go:116`), và popup là một overlay render một lần (`internal/page/overlay.go:244`) — thiết kế đúng là render theo từng dòng như quick view, một tính năng riêng |
| Form | field `form-*`; `specials.formRules` trên gốc form ẩn/hiện/bắt buộc field theo câu trả lời khác (is, isNot, filled, empty, contains, notContains) | `FormRulesPanel.vue` | `sb_store action:"form"`, rồi `sb_page_open form_id` + `sb_set specials.formRules` (kiểm tra theo từ vựng rule được sinh) | `runtime/src/nodes/form-conditions.ts`; server kiểm lại rule và required/định dạng/độ dài/khoảng (`server/internal/forms/submit.go`, `rules.go`) | một phần — 17 mẫu gồm booking và stay, tạo kèm `settings` của bản ghi (quy tắc đặt lịch); trùng tên/mapping bị từ chối trước khi lưu, trường không trả lời được bị cảnh báo. Chưa có field dẫn xuất, so sánh số; validation chéo chỉ có xác nhận số điện thoại và khoảng lưu trú |
| Giá trị mặc định | `form-select defaultValue`, text/number `prefillValue` (binding) | có | có | có | đủ |
| Điều hướng giữ query param | — | — | — | filter giữ các tham số không phải filter; UTM giữ trong session | **chưa có** dạng cơ chế chung |
| State / biến dùng chung | — | — | — | — | **chưa có** (`node.states` là style hover/active, không phải dữ liệu) |
| Cuộn tới section | `scroll_to` `{ targetId }` trên button/icon/image — web_builder #112 (`66a8763e0`) | picker node `ScrollEvent.vue` | `sb_event` cần `payload.targetId`; click duy nhất chiếu ra `#<id>` | `runtime/src/nodes/scroll-control.ts` (mượt, tôn trọng reduced-motion, chuyển focus) | đã hỗ trợ (v0.79.0) |
| Custom code | `custom-code` (`specials.code`) | Monaco, iframe sandbox trên canvas | `sb_add`; `sb_review custom_code_native` gợi ý khi element native làm được | renderer ghi thô | đủ — giữ cho embed bên thứ ba thật sự |
| Biểu thức binding | không có — binding là tra cứu theo source key | — | — | `runtime/src/core/define.ts` chỉ đường dẫn có dấu chấm, không eval | cố ý không có; không gì bị evaluate |

## Công thức

Mỗi công thức chỉ dùng element native. Id là chỗ giữ chỗ do tool tạo; đọc lại từ kết quả `sb_add`.

**Band nội dung responsive** — `sb_template_use sb_feature_trio` / `sb_image_text` (hoặc một
`sb_add` lồng `flex-section` → hàng `flex-block`), rồi `sb_set` với `breakpoint: "mobile"` cho
bố cục xếp chồng. `sb_look` cho thấy cả ba bề rộng.

**Danh sách có lọc, sắp xếp, trạng thái rỗng và phân trang**

```jsonc
// 1. repeater — binding được suy ra từ datasetSource
// specials.searchable / specials.filterable vắng = có; đặt false để loại một kệ tuyển chọn
{ "tool": "sb_add", "spec": { "type": "list-dataset", "config": { "datasetSource": "product", "loadingMode": "pagination" } } }
// 2. các control, ở đâu trên trang cũng được
{ "tool": "sb_add", "spec": { "type": "filter-checkbox", "specials": { "filterSource": "category" } } }
{ "tool": "sb_add", "spec": { "type": "select", "specials": { "filterSource": "sort" } } }
{ "tool": "sb_add", "spec": { "type": "search-input" } }
```

Trạng thái rỗng là satellite `list-empty` mà list mang (`config.emptyStateId`); thiết kế con của
nó như mọi node khác.

**Form có field phụ thuộc** — tạo form bằng `sb_store action:"form"`, mở tài liệu trường bằng
`sb_page_open form_id`, rồi ghi rule bằng `sb_set` trên GỐC FORM (rule thuộc về form, vì một rule
có thể có nhiều đích): `specials.formRules`, một mảng JSON
`{ id, join: "and"|"or", conditions: [{ field, op, value }], targets: [{ field, action }] }`
(`field` là `specials.name` của trường), `op` là một trong is, isNot, filled, empty, contains,
notContains và `action` là một trong hidden, shown, optional, required. Server chạy lại đúng các
rule đó khi submit (`server/internal/forms/rules.go`), nên field chỉ bắt buộc ở một nhánh cũng
được kiểm ở đó.

**Form dạng đặt lịch (lịch hẹn, salon, lưu trú khách sạn)** — nền tảng đã có bộ quy tắc đặt
lịch phía server (sức chứa theo slot và theo ngày, báo trước và giới hạn xa nhất, ngày đóng cửa,
số đêm lưu trú, đặt cọc, `server/internal/forms/booking.go`).

1. Cài app Booking: `sb_store action:"app" app_key:"booking"`. Thiếu app, nền tảng từ chối form
   loại booking (`booking_app_required`).
2. `sb_store action:"form" template:"booking"` cho lịch hẹn (một ngày + khung giờ), hoặc
   `template:"stay"` cho lưu trú (hai ngày), kèm `settings: { booking: { … } }` —
   `maxPerSlot` / `slotCapacity` cho salon, `minStayNights` / `maxStayNights` / `closedDates`
   cho khách sạn.
3. `sb_page_open form_id:<id>`, rồi `sb_add` trường — một `form-select` "Dịch vụ" có `options`
   và `specials.name` — trường mới nằm trên nút gửi; thêm quy tắc ở node gốc qua
   `specials.formRules`.
4. **Quy tắc lưu trú theo vị trí:** trên form booking, HAI trường ngày ĐẦU TIÊN
   (`form-calendar` / `form-date`) theo thứ tự trong tài liệu là ngày nhận và trả phòng. Giữ một
   ngày (lịch hẹn) hoặc hai (lưu trú); ngày thứ ba bị mọi quy tắc đặt lịch bỏ qua và sẽ bị cảnh
   báo.
5. Số người là một `form-number` với `specials.step: 1` (template `event` và `stay` đã seed
   sẵn): cả trình duyệt lẫn server đều từ chối 2.5 (`step_mismatch`). Để `step: 0` cho số đo.
6. Đặt form lên một trang và publish lại trang đó. Khi gửi, server còn từ chối slot hôm nay đã
   bắt đầu (`booking_slot_past`), slot không nằm trên lưới khung giờ, và câu trả lời
   select/radio không thuộc danh sách lựa chọn (`not_an_option`).

**Popup về item vừa bấm** — với sản phẩm, `quickview` (list `config.quickviewId`) là câu trả lời
native: list render một panel cho mỗi card dưới chính bản ghi của card đó. Popup tổng quát mang
context của item thì nền tảng chưa hỗ trợ (xem bảng); đừng giả lập bằng custom code đọc DOM.

**Nhảy tới một section** — `sb_event` trên một nút với
`action: "scroll_to"`, `payload: { targetId: "<id section>" }`. Lệnh click cũng lưu
`specials.href: "#<id>"`, nên vẫn tới đúng chỗ khi tắt JavaScript.

## Khi một thứ chưa được hỗ trợ

Tool nói rõ thay vì lặng lẽ lưu lại:

- key config/specials lạ trên `sb_add` / `sb_set` → check `unknown_key`, và nếu key nằm ở
  namespace kia thì phần sửa chỉ ra (`filterSource` là một SPECIAL);
- binding vào special mà element không đọc → `sb_bind` từ chối (ghi đè bằng `force`);
- action element không cho phép, hoặc điều hướng thiếu đích → `sb_event` từ chối kèm payload
  mong đợi;
- giá trị đã lưu mà renderer không đọc, element dataset không có context dữ liệu, hoặc action
  sai đã nằm trong tài liệu → `sb_review` (`unread_value`, `no_data_context`, `invalid_action`,
  `action_missing_target`).

## Tái tạo lại

`test/fixtures-native.test.ts` dựng từng fixture qua các tool công khai trên một nền tảng giả có
trạng thái (`test/helpers/platform.ts`): trang nội dung responsive, danh sách có tìm kiếm, lọc,
sắp xếp, phân trang và trạng thái rỗng, popup mở từ một nút, và điều hướng.
`test/form-document.test.ts` phủ form có field phụ thuộc. Không cái nào dùng custom code.
