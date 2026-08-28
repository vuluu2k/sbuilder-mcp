# `sbuilder-mcp`

Máy chủ MCP chạy trên **stdio**, cho phép một AI agent vận hành trọn vẹn một site
[Store Builder](https://sbuilder.io.vn) — thiết kế trang, đổ dữ liệu thật vào, tự nhìn kết
quả rồi xuất bản — mà không cần người bấm gì.

*[English](./README.md)*

## Cài đặt

Một lệnh ghi server này vào mọi agent client trên máy bạn:

```bash
npx -y sbuilder-mcp install --token wbk_… --api https://your-host
```

Nó biết Claude Code, Claude Desktop, Cursor, Windsurf, VS Code và Codex, và cài vào những
cái nó tìm thấy. Chỉ định bằng `--client cursor,codex`, hoặc diễn thử với `--dry-run`.

Nó **gộp**: các server đã có trong file được giữ nguyên, thứ nó thay thế được chép sang
`<file>.sbuilder-backup`, và một config nó không đọc được thì bị từ chối chứ không ghi đè —
một file thừa dấu phẩy khả dĩ hơn nhiều một file đáng vứt, và đó chính là thứ bạn cần để sửa.

Màn hình **Apps → AI agent** của cửa hàng đưa sẵn lệnh này kèm khoá.

<details><summary>Hoặc tự cấu hình từng client</summary>

```json
{
  "mcpServers": {
    "sbuilder": {
      "command": "npx",
      "args": ["-y", "sbuilder-mcp"],
      "env": { "SB_API": "https://api.your-host", "SB_TOKEN": "wbk_…" }
    }
  }
}
```

</details>

## Lấy khoá ở đâu

Mở cửa hàng của bạn, vào **Apps → AI agent**, bấm **Tạo khoá**. Màn hình đó đưa luôn khối
cấu hình cho client bạn dùng, khoá đã điền sẵn — cả mục này chỉ để bạn khỏi phải đọc.

Một khoá là đủ. Nó với tới cả bề mặt đối tác (`/api/v1`) lẫn private site API, gồm tài liệu
trang và socket live-edit, và bị chặn ba lớp ở mỗi request: scope của chính nó, role sống của
thành viên đã tạo ra nó, và đúng một cửa hàng nó thuộc về.

`SB_EMAIL` + `SB_PASSWORD` vẫn tuỳ chọn, và mua đúng một thứ: các lệnh **cấp tài khoản** —
liệt kê site, quản lý thành viên và role — mà khoá cố ý không làm được, vì những thứ đó nghĩa
là "tài khoản của người này".

`SB_API` mặc định `http://localhost:8080`. Bí mật chỉ đọc từ biến môi trường.

## Bộ tool

| Tool | Làm gì |
| --- | --- |
| `sb_connect` | Đăng nhập, liệt kê site tài khoản vận hành được, báo đang có credential nào |
| `sb_site_list` | Liệt kê site tài khoản vận hành được |
| `sb_api_find` | Tìm operation theo ý định — trả về schema tham số thật, credential cần dùng, và cảnh báo rõ ràng khi tài liệu của nền tảng không mô tả request body |
| `sb_api_call` | Chạy một operation. Mặc định chạy khô, không gửi gì |
| `sb_page_open` | Mở một trang để sửa và trả về outline |
| `sb_outline` | Trang đang mở dạng cây nén — không bao giờ dump tài liệu thô |
| `sb_node_read` | Một node đầy đủ, kèm cảnh báo nếu nó là global dùng chung |
| `sb_catalog_search` | Tìm element theo việc nó cần làm, dùng chính AI hints của nền tảng |
| `sb_traits_for` | Element nhận nhóm trait nào, kèm default và luật chứa con |
| `sb_add` | Thêm một element — hoặc cả cây con lồng nhau — trong một lần gọi |
| `sb_set` | Ghi style/config/specials. Mặc định theo breakpoint |
| `sb_move` | Chuyển node sang cha khác |
| `sb_remove` | Xoá node và cả cây con |
| `sb_duplicate` | Nhân bản một node và cả cây con dưới id mới, ngay sau bản gốc |
| `sb_templates` | Section template đã lưu của cửa hàng — section thiết kế sẵn để bắt đầu |
| `sb_template_use` | Thả một template vào trang |
| `sb_page_list` | Mọi trang của site |
| `sb_page_create` | Tạo một trang |
| `sb_publish` | Biên dịch bản nháp thành trang live (lan sang global dùng chung) |
| `sb_live_join` | Vào phòng live-edit của editor như một peer nhìn thấy được — sửa gì hiện ngay |
| `sb_look` | Lưu, render, trả về ảnh chụp kèm box đo được của từng node |
| `sb_bind` | Gắn nội dung một node vào dữ liệu cửa hàng thật |

Hai mươi hai tool, **310 operation API**. `sb_api_find` là một chỉ mục chứ không phải mỗi endpoint một
tool, nên danh sách tool vẫn ngắn trong khi mọi thứ nền tảng làm được vẫn với tới — và
operation mới thêm bên nền tảng sẽ tự có sau lần `npm run codegen` kế tiếp.

Tra cứu đầy đủ: [`docs/tools.vi.md`](./docs/tools.vi.md).

## Cách nó không bị lệch

Nền tảng có sẵn hai artifact đã sinh và đã commit. Một bước build đọc chúng từ một checkout
rồi sinh ra catalog:

```bash
WB_REPO=/duong/dan/web_builder npm run codegen
```

Nhờ vậy repo này không vendor dòng code nào của nền tảng — nó chỉ phụ thuộc vào hai file dữ
liệu có hợp đồng được bảo trì. `src/catalog/api.generated.ts` được commit, nên `npm install`
không cần checkout nào cả.

## Phát triển

```bash
npm run build     # tsc -> dist/
npm test          # vitest
npm run smoke     # tự kiểm offline; phải in ALL GOOD
```

Hướng dẫn đóng góp: [`CLAUDE.md`](./CLAUDE.md). Lý do thiết kế:
[`docs/superpowers/specs/`](./docs/superpowers/specs/).

## Thiết kế an toàn

Bốn luật của nền tảng hỏng **im lặng** nếu client không biết, nên chúng được viết thành code
có test chứ không phải lời khuyên:

- **Thứ tự băng** — con của ROOT phải đọc `[header][middle][footer]`, sai là nền tảng từ
  chối mọi lần lưu.
- **Site overlay** (cart drawer, pop-up) được ghép lên ROOT lúc đọc và bóc ra lúc ghi; nó bị
  loại khỏi mọi luật cấp ROOT và không sửa được qua bộ page tool.
- **Global section** là master dùng chung — sửa một cái là đổi mọi trang mang nó, và publish
  thì lan. Mọi kết quả đụng tới nó đều nói rõ.
- **Mặc định responsive** — `sb_set` ghi theo breakpoint, vì một thiết kế nên đáp ứng. Base
  là lớp dự phòng của cascade, không phải cái bẫy.

## Trạng thái

Cả ba giai đoạn đã xong: xác thực và với tới toàn bộ API; tài liệu trang, giao thức patch,
builder và bốn cái bẫy; socket live-edit, luật nhường, và vòng lặp thị giác.

Cần **Node ≥22** (WebSocket toàn cục) và, chỉ với `sb_look`, **Google Chrome của hệ thống** —
`playwright-core` không kèm trình duyệt nào nên lúc cài không tải gì.

MIT.
