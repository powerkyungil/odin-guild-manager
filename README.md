# 한울ON · 오딘 길드 운영 도구

오딘: 발할라 라이징 길드의 보스 일정, 참여 투표, 길드원 정보와 아이템·재화 현황을 관리하는 웹 애플리케이션입니다.

이 저장소는 HTML, CSS, Vanilla JavaScript로 만든 웹 화면과 API 연동 코드를 포함합니다. 화면의 데이터 요청은 `/api/v1` 계약을 사용하며, `api-config.js`가 실행 환경에 따라 API 서버 주소를 선택합니다.

## 주요 기능

- **공지**: 길드 규칙, 가격표, 보스 통제 상태를 등록하고 공유합니다.
- **보스 스케줄**: 본서버·침공·공통 보스와 고정 이벤트를 관리하고 리젠 시간을 계산합니다.
- **스크린샷 OCR**: 길드장이 보스 시간표 이미지를 분석해 일정 입력을 보조할 수 있습니다.
- **보스 참여 투표**: 오늘·내일 투표, 수동 보스 추가, 참여 현황과 기간별 참여율을 제공합니다.
- **손지원 매칭**: 지원 요청과 신청자를 연결하고 진행 상태를 관리합니다.
- **길드원 아이템 현황**: 고정 아이템 ID 기반으로 컬렉션 달성 여부와 분배 제외 대상을 관리합니다.
- **컨텐츠 참여**: 드래그 앤 드롭으로 길드원 참여 그룹을 편성합니다.
- **공성전 참여**: 길드원별 보유·잔여 다이아를 관리합니다.
- **길드원 분배금**: 기간별 재화, 참여율과 연합 분배율을 기준으로 분배금을 계산하고 확정 내역을 관리합니다.
- **길드원 관리**: 프로필, 캐릭터, 장비, 스킬, 전투력과 역할을 관리합니다.
- **계정·길드 설정**: 초대 링크, 길드명, 전투력 수정 권한, 테마와 임시 점검 모드를 관리합니다.
- **알림**: 보스 스케줄의 웹 음성 알림과 서버 설정에 따른 Discord 알림을 지원합니다.

## 구조와 API 연결

현재 프런트엔드는 API 서버와 분리해 배포할 수 있는 정적 웹 화면입니다.

| 환경 | 기본 API 주소 |
| --- | --- |
| `localhost`, `127.0.0.1` | `http://localhost:3001` |
| 그 외 호스트 | `https://api.hanul-on.cloud` |

운영 호스트에서 다른 API를 사용하려면 `api-config.js`보다 먼저 `window.ODIN_API_ORIGIN`을 지정합니다.

```html
<script>
  window.ODIN_API_ORIGIN = 'https://api.example.com';
</script>
<script src="api-config.js"></script>
```

로컬 호스트에서는 개발 API 주소가 항상 `http://localhost:3001`로 선택됩니다. 따라서 로컬 화면을 사용하려면 해당 주소에서 `/api/v1` API를 제공하는 서버가 실행 중이어야 합니다.

저장소의 `server.js`에는 Express·SQLite 기반 독립 서버가 포함되어 있습니다. 이 서버는 정적 파일, 기존 `/api` 호환 엔드포인트, 데이터베이스 초기화·마이그레이션과 개인정보 관련 테스트에 사용됩니다. 현재 화면이 호출하는 `/api/v1` 서비스가 별도 배포되어 있다면 `node server.js`만 실행해서 최신 화면의 API까지 대체할 수는 없습니다.

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| 화면 | HTML, CSS, Vanilla JavaScript |
| API·독립 서버 | Node.js, Express 5 |
| 데이터베이스 | SQLite 3 |
| 인증 | JWT, bcryptjs |
| 외부 연동 | Discord.js, NAVER Cloud CLOVA Template OCR |
| 브라우저 기능 | Web Speech API |
| 운영 | PM2, XAMPP Apache 또는 정적 웹 서버 |

## 시작하기

### 요구 사항

- Node.js 18 이상
- npm
- 로컬 개발용 `/api/v1` API 서버
- 웹 화면을 제공할 정적 웹 서버

XAMPP는 필수가 아닙니다. 프로젝트가 XAMPP의 `htdocs` 아래에 있더라도 화면은 정적 웹 서버로, API는 `api-config.js`에 지정된 API 서버로 요청합니다.

### 설치

```bash
git clone https://github.com/powerkyungil/odin-guild-manager.git
cd odin-guild-manager
npm ci
```

### 화면 실행

프로젝트 루트를 XAMPP Apache나 다른 정적 웹 서버로 제공한 뒤 로그인 화면을 엽니다.

```text
http://localhost/<프로젝트-경로>/login.html
```

XAMPP를 사용하는 경우 프로젝트 폴더를 `htdocs` 아래에 두면 됩니다. 브라우저에서 HTML 파일을 직접 여는 `file://` 방식은 API 요청과 인증이 정상적으로 동작하지 않을 수 있습니다.

### 독립 Express·SQLite 서버 실행

`server.js` 자체를 실행하거나 개인정보·컬렉션 마이그레이션 테스트를 확인할 때 사용할 수 있습니다. 운영 환경에서는 반드시 별도의 데이터베이스 경로와 강력한 JWT 비밀키를 지정하세요.

```bash
PORT=3000 \
DB_PATH=/absolute/path/to/database.sqlite \
JWT_SECRET='예측하기-어려운-긴-비밀키' \
node server.js
```

기본 포트는 `3000`이며, 서버가 실행되면 정적 화면은 `http://localhost:3000`에서 확인할 수 있습니다. 다만 최신 화면의 `/api/v1` 요청은 위에서 설명한 API origin 규칙을 따릅니다.

## 최초 계정과 기본 데이터

독립 서버를 빈 SQLite 데이터베이스로 시작하면 스키마, 기본 보스 목록, 고정 이벤트와 컬렉션 데이터가 준비됩니다. 길드장 계정이 없을 때 다음 계정도 생성됩니다.

| 항목 | 기본값 |
| --- | --- |
| 아이디 | `master` |
| 비밀번호 | `password123` |
| 역할 | `MASTER` (길드장) |

최초 로그인 후 즉시 비밀번호와 프로필을 변경하세요. 운영 데이터베이스에 기본 비밀번호를 남겨두지 마세요.

## 권한

| 역할 | 설명 |
| --- | --- |
| `MASTER` | 길드장. 길드 설정, 회원·역할 관리, 운영 데이터 관리와 전체 권한을 가집니다. |
| `ADMIN` | 운영진. 허용된 일정, 투표, 공지, 컬렉션과 그룹 운영 기능을 관리합니다. |
| `MEMBER` | 길드원. 일정 확인, 투표 참여, 본인 프로필과 허용된 참여 현황을 관리합니다. |

권한은 화면뿐 아니라 API에서도 확인합니다. 길드장 계정은 다른 회원에게 역할을 이전하기 전에는 삭제할 수 없습니다.

## 외부 서비스 설정

### CLOVA Template OCR

보스 스케줄의 스크린샷 분석을 사용하려면 OCR을 제공하는 API 서버에 다음 환경 변수를 설정합니다.

```bash
CLOVA_OCR_INVOKE_URL='https://...apigw.ntruss.com/.../infer'
CLOVA_OCR_SECRET='CLOVA OCR Client Secret'
CLOVA_OCR_TEMPLATE_ID='12345'
CLOVA_OCR_TEMPLATES='본섭:12345,침공:67890'
```

`CLOVA_OCR_TEMPLATES`는 `표시 이름:템플릿 ID`를 쉼표로 구분합니다. 예를 들어 `본섭:12345,침공:67890`으로 지정하면 화면에서 두 템플릿을 선택할 수 있습니다.

이미지는 브라우저에서 OCR 권장 크기로 최적화된 뒤 요청 처리 중에만 전달되며 서버 디스크에 저장하지 않습니다. `CLOVA_OCR_SECRET`은 프런트엔드 코드, 저장소와 브라우저에 노출하지 마세요.

### Discord 알림

Discord 알림을 사용하는 경우 봇을 길드 서버에 초대하고 알림 채널에 채널 보기·메시지 보내기 권한을 부여합니다. 봇 토큰은 API 서버에서만 관리하며 저장소에 커밋하지 않습니다. 보스 알림은 출현 5분 전, 1분 전과 출현 시점에 전송됩니다.

## 데이터 저장과 마이그레이션

`server.js`를 사용하는 독립 서버의 기본 데이터베이스 경로는 프로젝트 루트의 `database.sqlite`입니다. `DB_PATH` 환경 변수로 경로를 바꿀 수 있습니다.

```bash
# 서버를 중지한 뒤 백업
cp database.sqlite database.sqlite.backup

# 백업 복원
cp database.sqlite.backup database.sqlite
```

현재 애플리케이션에는 자동 백업 보관 절차가 없습니다. 운영 데이터베이스는 정기적으로 별도 위치에 백업하고, 복원 작업은 서버와 모든 쓰기 작업을 중지한 뒤 수행하세요.

보스 일정·참여 이력은 기본 90일 동안 보관되며 서버 시작 시와 하루 한 번 정리됩니다. 보관 기간은 다음 변수로 변경할 수 있습니다.

```bash
BOSS_HISTORY_RETENTION_DAYS=90
```

### 컬렉션 현황 V2

컬렉션 화면은 고정 `collection_item_id`를 사용하는 V2를 기준으로 동작합니다. 기존 `user_collections` 데이터는 삭제하지 않고 새 구조로 한 번 복사하며, 마이그레이션은 서버 초기화 과정에서 자동으로 실행됩니다.

운영 데이터베이스를 변경하기 전 반드시 백업하고, 마이그레이션 후 검사합니다.

```bash
DB_PATH=/absolute/path/to/database.sqlite npm run audit:collection-migration
```

검사 결과에서 `unmatchedLegacyChecks`와 `orphanV2Checks`가 모두 `0`이어야 합니다.

## 테스트와 점검

`package.json`에 등록된 검증 명령은 다음과 같습니다.

| 명령 | 확인 내용 |
| --- | --- |
| `npm run test:api-config` | 환경별 API 주소와 브라우저 API 어댑터 |
| `npm run test:api-contracts` | 화면의 `/api/v1` 계약 사용 여부와 점검 화면 계약 |
| `npm run test:privacy` | 개인정보처리방침, 계정 삭제와 하드 삭제 흐름 |
| `npm run test:collection-migration` | 컬렉션 V2 마이그레이션과 권한 |
| `npm run test:distributions-ui` | 분배금 화면의 주요 UI·API 계약 |
| `npm run audit:collection-migration` | 운영 SQLite의 컬렉션 마이그레이션 상태 |

코드 변경 후 정적 검증은 다음처럼 한 번에 실행할 수 있습니다.

```bash
npm run test:api-config
npm run test:api-contracts
npm run test:privacy
npm run test:collection-migration
npm run test:distributions-ui
```

## PM2 운영 예시

독립 Express 서버를 PM2로 실행하는 예시입니다.

```bash
JWT_SECRET='예측하기-어려운-긴-비밀키' \
PORT=3000 \
DB_PATH=/srv/odin/database.sqlite \
npx pm2 start server.js --name odin-guild-manager

npx pm2 status
npx pm2 logs odin-guild-manager
```

서버 재부팅 후 자동 실행이 필요하면 PM2의 `startup`과 `save`를 추가로 설정하세요. 외부에 공개할 때는 HTTPS와 신뢰할 수 있는 리버스 프록시를 사용하세요.

## 프로젝트 구조

```text
.
├── api-config.js              # 환경별 API 주소와 응답 어댑터
├── server.js                  # Express·SQLite 독립 서버, 초기화·마이그레이션
├── app.js                     # 보스 스케줄 화면과 OCR·웹 음성 알림
├── boss_vote.js               # 보스 참여 투표 화면
├── distributions.js           # 분배금 화면 로직
├── collections_data.js        # 초기 컬렉션 데이터
├── login.html                 # 로그인
├── register.html              # 초대 링크 기반 회원가입
├── menu.html                  # 메인 메뉴
├── boss_schedule.html         # 보스 스케줄
├── boss_vote.html             # 보스 참여 투표
├── notice.html                # 공지·가격표·보스 통제
├── support.html               # 손지원 매칭
├── collections_v2.html        # 아이템 현황 V2
├── collection_logs.html       # 컬렉션 변경 이력
├── content.html               # 컨텐츠 참여 그룹
├── siege.html                 # 공성전 참여
├── distributions-list.html    # 분배 기간 목록
├── distributions.html         # 분배금 상세·계산
├── members.html               # 길드원 관리
├── settings.html              # 길드 설정·가입 링크
├── edit_profile.html          # 내 정보 수정·계정 삭제
├── privacy.html               # 개인정보처리방침
├── delete-account.html        # 비로그인 계정 삭제
└── scripts/                   # API 계약·마이그레이션·개인정보 검증 스크립트
```

`collections.html`은 이전 컬렉션 화면에서 V2로 이동시키는 호환 페이지입니다.

## 개인정보와 계정 삭제

- 개인정보처리방침: [`/privacy`](privacy.html)
- 계정 삭제: [`/delete-account`](delete-account.html)
- 개인정보 문의: `dev.kyungil@icloud.com`

계정 삭제 시 계정에 직접 연결된 프로필, 캐릭터, 참여, 컬렉션, 그룹, 공성전과 손지원 정보가 운영 데이터베이스에서 삭제됩니다. 삭제된 계정은 복구할 수 없으며, 길드장은 역할을 이전한 뒤 삭제할 수 있습니다.

## 운영 전 확인 사항

- 기본 `master` 비밀번호를 즉시 변경합니다.
- 운영 API와 독립 서버에 강력하고 예측하기 어려운 `JWT_SECRET`을 지정합니다.
- OCR 비밀키, Discord 봇 토큰, SQLite 데이터베이스와 운영용 설정 파일을 저장소에 커밋하지 않습니다.
- API와 웹 화면을 외부에 공개할 때 HTTPS를 적용합니다.
- 배포 전 백업·복원 절차와 컬렉션 마이그레이션 검사 결과를 확인합니다.
