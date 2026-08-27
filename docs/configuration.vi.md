# Cấu hình

Mọi giá trị đọc từ biến môi trường. Không đọc từ file nào, và không bí mật nào được ghi ra
file — repo này công khai.

| Biến | Bắt buộc | Mặc định | Là gì |
| --- | --- | --- | --- |
| `SB_API` | không | `http://localhost:8080` | URL gốc của API nền tảng |
| `SB_TOKEN` | nên có | — | Khoá API `wbk_` tạo trong app. Cũng nhận app access token `wba_` |
| `SB_EMAIL` | tuỳ chọn | — | Một tài khoản nền tảng |
| `SB_PASSWORD` | tuỳ chọn | — | Mật khẩu tài khoản đó |
| `WB_REPO` | chỉ khi codegen | — | Đường dẫn tới checkout `web_builder`. Không cần lúc chạy |

## Một biến là đủ

`SB_TOKEN` một mình mở được mọi thứ server này làm hằng ngày. Một khoá API lấy từ app
**Agent** của site với tới được cả bề mặt đối tác (`/api/v1`) lẫn bề mặt tài nguyên của
private site API, gồm cả tài liệu trang và socket live-edit.

Nó bị chặn ba lớp, kiểm mỗi request: scope của chính khoá, role sống của thành viên đã mint
nó, và đúng một site nó thuộc về. Hạ quyền thành viên đó là mọi khoá họ mint hẹp lại ngay;
thu hồi khoá là nó tắt ở mọi nơi cùng lúc.

`SB_EMAIL` / `SB_PASSWORD` vẫn dùng được cho người chạy trên tài khoản của chính mình. Chúng
mua đúng một thứ mà khoá cố ý không làm được: các lệnh **cấp tài khoản** — liệt kê site,
quản lý thành viên và role — vì những thứ đó nghĩa là "tài khoản của người này", mà khoá thì
không có người nào đứng sau.

## Vì sao trước đây phải hai credential

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
