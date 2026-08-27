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

Bốn tool, **310 operation**. `sb_api_find` là một chỉ mục chứ không phải mỗi endpoint một
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

## Trạng thái

Giai đoạn 1 trên 3. Đã xong: xác thực, chỉ mục API sinh tự động, và với tới toàn bộ API.
Tiếp theo: tài liệu trang (model, giao thức patch, builder), rồi socket live-edit, hiện
diện realtime, và vòng lặp tự nhìn ảnh chụp.

MIT.
