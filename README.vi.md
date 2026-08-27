# `@sbuilder/mcp`

Máy chủ MCP chạy trên **stdio**, cho phép một AI agent vận hành trọn vẹn một site
[Store Builder](https://sbuilder.io.vn) — thiết kế trang, đổ dữ liệu thật vào, tự nhìn kết
quả rồi xuất bản — mà không cần người bấm gì.

*[English](./README.md)*

## Cài đặt

```bash
npx -y @sbuilder/mcp
```

Claude Code / Claude Desktop:

```json
{
  "mcpServers": {
    "sbuilder": {
      "command": "npx",
      "args": ["-y", "@sbuilder/mcp"],
      "env": {
        "SB_API": "https://api.your-host",
        "SB_TOKEN": "wbk_…",
        "SB_EMAIL": "ban@example.com",
        "SB_PASSWORD": "…"
      }
    }
  }
}
```

## Hai credential, và vì sao phải có cả hai

Nền tảng từ chối mỗi loại trên bề mặt của loại kia, nên đây không phải lựa chọn:

| Credential | Với tới |
| --- | --- |
| `SB_TOKEN` — khoá API `wbk_` bạn tạo trong app | `/api/v1`: sản phẩm, đơn hàng, khách hàng, media, blog, metadata trang, webhook |
| `SB_EMAIL` + `SB_PASSWORD` — một tài khoản thường | mọi thứ dưới `/api/sites/…`: trang, menu, theme, form, overlay, bản dịch, cài đặt — và socket live-edit |

Gửi token phiên vào `/api/v1` sẽ nhận `401 api_key_required`; gửi khoá API vào private API
cũng bị từ chối. `sb_connect` cho biết bạn đang có nửa nào.

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

Mười ba tool, **310 operation API**. `sb_api_find` là một chỉ mục chứ không phải mỗi endpoint một
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
- **Luật responsive** — đại lượng thị giác ghi ở base sẽ hiện trên canvas rồi biến mất lúc
  publish, nên `sb_set` mặc định ghi theo breakpoint và từ chối ghi base cho mọi thứ không
  phải định danh.

## Trạng thái

Giai đoạn 1 và 2 trên 3. Đã xong: xác thực, chỉ mục API sinh tự động, với tới toàn bộ API,
tài liệu trang, giao thức patch, builder, và bốn cái bẫy. Tiếp theo: socket live-edit, hiện
diện realtime, và vòng lặp tự nhìn ảnh chụp.

MIT.
