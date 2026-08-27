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
