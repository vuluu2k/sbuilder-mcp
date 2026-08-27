# Cấu hình

Mọi giá trị đọc từ biến môi trường. Không đọc từ file nào, và không bí mật nào được ghi ra
file — repo này công khai.

| Biến | Bắt buộc | Mặc định | Là gì |
| --- | --- | --- | --- |
| `SB_API` | không | `http://localhost:8080` | URL gốc của API nền tảng |
| `SB_TOKEN` | với `/api/v1` | — | Khoá API `wbk_` tạo trong app. Cũng nhận app access token `wba_` |
| `SB_EMAIL` | với private API | — | Một tài khoản nền tảng |
| `SB_PASSWORD` | với private API | — | Mật khẩu tài khoản đó |
| `WB_REPO` | chỉ khi codegen | — | Đường dẫn tới checkout `web_builder`. Không cần lúc chạy |

## Vì sao phải hai credential

Nền tảng khai báo một scheme `BearerAuth` duy nhất trong tài liệu OpenAPI nhưng thực thi
hai credential khác nhau đằng sau nó, và từ chối mỗi loại trên bề mặt của loại kia.
`/api/v1` trả `401 api_key_required` cho token phiên; private API không nhận khoá `wbk_`.
Nên `src/transport/credential.ts` định tuyến theo tiền tố path, và luật đó được test chứ
không suy đoán ở từng chỗ gọi.

Bạn có thể chạy với chỉ một loại. `sb_connect` báo nửa nào đang với tới được, và khi thiếu
`SB_TOKEN` thì tên biến được nêu đích danh ngay lần đầu gọi một operation `/api/v1`, thay
vì hiện ra như một lỗi phân quyền từ nền tảng.

## Tuổi thọ phiên

Access token của phiên sống khoảng mười lăm phút và xoay vòng mỗi lần refresh. Nó được đọc
qua getter ở mỗi lần dùng, không bao giờ giữ lại — một client cầm chuỗi lúc khởi tạo sẽ
phát lại token hết hạn mãi mãi, và lỗi đó im lặng hoàn toàn.
