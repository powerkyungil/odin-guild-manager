# 오딘 길드 운영 도구

오딘: 발할라 라이징 길드 운영에 필요한 보스 일정, 참여 투표, 길드원 정보와 각종 참여 현황을 한곳에서 관리하는 웹 애플리케이션입니다. Node.js/Express 서버가 정적 웹 화면과 REST API를 함께 제공하며, 데이터는 로컬 SQLite 파일에 저장됩니다.

## 주요 기능

- **보스 스케줄**: 본서버·침공·고정 일정 등록, 자동 리젠 시간 계산, 멍/컷 처리, 참여자 관리
- **보스 참여 투표**: 오늘·내일 투표, 수동 투표 추가, 참여 현황 및 기간별 참여율 확인
- **알림**: 브라우저 음성 알림과 Discord TTS 알림 지원
- **공지 관리**: 길드 규칙, 가격표, 보스 통제 상태 관리
- **길드원 관리**: 캐릭터·장비·스킬·전투력 정보 관리와 역할/비밀번호 관리
- **아이템 컬렉션**: 길드원별 컬렉션 달성 현황과 분배 제외 대상 관리
- **콘텐츠 그룹**: 드래그 앤 드롭 방식의 참여 그룹 편성
- **공성전 현황**: 길드원별 보유·잔여 다이아 관리
- **손지원 매칭**: 지원 요청, 신청, 매칭과 완료 상태 관리
- **짱깸보**: 운영진이 아이템·참여 인원·참가자를 지정하는 길드 아이템 추첨
- **길드 설정**: 길드명, 길드원의 전투력 수정 권한, 가입 링크와 Discord 연동 설정
- **화면 설정**: 다크블루·샌드골드 테마 및 보스 일정 상세/간략 보기

## 기술 스택

| 구분 | 기술 |
| --- | --- |
| 서버 | Node.js, Express 5 |
| 데이터베이스 | SQLite 3 |
| 인증 | JWT, bcryptjs |
| 알림 연동 | Discord.js, Web Speech API |
| 화면 | HTML, CSS, Vanilla JavaScript |
| 프로세스 관리 | PM2 |

## 시작하기

### 요구 사항

- Node.js 18 이상
- npm

XAMPP는 필수가 아닙니다. 이 저장소가 XAMPP의 `htdocs` 아래에 있더라도 애플리케이션은 Node.js 서버로 실행됩니다.

### 설치 및 실행

```bash
git clone <repository-url>
cd odin_boss_schedule
npm install
```

운영 환경에서는 반드시 예측하기 어려운 JWT 비밀키를 지정하세요.

```bash
export JWT_SECRET='충분히-길고-무작위인-비밀키'
export PORT=3000
node server.js
```

브라우저에서 [http://localhost:3000](http://localhost:3000)에 접속합니다.

> 로컬 개발 환경에서는 프로젝트 루트의 `.env` 파일을 자동으로 읽습니다. `.env.example`을 복사해 값을 설정하세요. 배포 환경에서는 호스트 또는 PM2의 환경 변수를 사용하세요.

### CLOVA Template OCR 설정

보스 시간표 스크린샷 기능은 **CLOVA Template OCR**을 사용합니다. CLOVA OCR 콘솔에서 시간표 UI를 기준 이미지로 등록하고, 인식할 각 필드(예: `boss_1`, `time_1`)를 지정한 뒤 API Gateway 연동 정보를 설정하세요.

서버에는 다음 환경 변수만 전달합니다. `CLOVA_OCR_SECRET`은 브라우저나 저장소에 넣으면 안 됩니다.

```bash
export CLOVA_OCR_INVOKE_URL='https://...apigw.ntruss.com/.../infer'
export CLOVA_OCR_SECRET='CLOVA OCR Client Secret'
export CLOVA_OCR_TEMPLATE_ID='12345'
export CLOVA_OCR_TEMPLATES='본섭:12345,침공:67890'
```

`CLOVA_OCR_TEMPLATES`를 설정하면 보스 시간표 화면에서 이름으로 템플릿을 선택할 수 있습니다. 각 항목은 `표시 이름:템플릿 ID` 형식이며 쉼표로 구분합니다. 스크린샷은 브라우저에서 장축 1960px 이하 JPEG로 정규화되고, 서버는 한 번에 한 건만 CLOVA OCR로 전달합니다. 이미지는 서버 디스크에 저장하지 않습니다.

### 최초 로그인

데이터베이스에 길드장 계정이 없으면 서버 시작 시 아래 계정이 자동 생성됩니다.

| 항목 | 값 |
| --- | --- |
| 아이디 | `master` |
| 비밀번호 | `password123` |
| 역할 | `MASTER` (길드장) |

최초 로그인 직후 **정보수정**에서 비밀번호와 캐릭터 정보를 변경하세요.

## 기본 사용 흐름

1. 길드장 계정으로 로그인합니다.
2. **설정**에서 길드 이름과 운영 정책을 지정합니다.
3. **가입 링크**에서 길드원 또는 운영진 초대 링크를 생성합니다.
4. 가입한 길드원이 캐릭터 정보를 등록합니다.
5. 보스 일정, 투표, 컬렉션, 콘텐츠 그룹 등 필요한 메뉴를 사용합니다.

초대 링크는 생성 후 1시간 동안 유효하며 한 번만 사용할 수 있습니다.

## 권한

| 역할 | 설명 |
| --- | --- |
| `MASTER` | 길드장. 전체 관리 기능과 역할 변경, 회원 삭제 권한을 가집니다. |
| `ADMIN` | 운영진. 일정·투표·공지·컬렉션·그룹·설정 등 운영 기능을 관리합니다. |
| `MEMBER` | 길드원. 일정 확인, 투표 참여, 본인 정보 및 허용된 현황을 관리합니다. |

일부 세부 작업은 서버 API에서 역할을 다시 검사하므로 화면 요소를 직접 호출해도 권한 없이 실행할 수 없습니다.

기존 아이템 현황(V1)은 `MASTER`만 접근할 수 있습니다. V2 체크 상태는 `MASTER`만 모든 길드원을 수정할 수 있으며, `ADMIN`과 `MEMBER`는 본인 상태만 수정할 수 있습니다.

## Discord 알림 설정

1. Discord Developer Portal에서 봇을 만들고 길드 서버에 초대합니다.
2. 알림 채널에서 봇에 **채널 보기**와 **메시지 보내기** 권한을 부여합니다.
3. 애플리케이션의 **설정 → 디스코드**에 봇 토큰과 채널 ID를 입력합니다.
4. 설정을 저장한 뒤 **테스트 알림**으로 연결을 확인합니다.

연동이 활성화되면 등록된 보스의 출현 5분 전, 1분 전과 출현 시점에 Discord TTS 메시지를 전송합니다. 봇은 `Guilds` 인텐트만 사용하며 메시지 내용을 수신하지 않습니다.

## 데이터 저장과 백업

실행 중 생성되는 모든 데이터는 프로젝트 루트의 `database.sqlite`에 저장됩니다. 첫 실행 시 테이블, 기본 보스 목록, 고정 일정과 초기 길드장 계정이 자동으로 준비됩니다.

```bash
# 서버를 중지한 뒤 백업
cp database.sqlite database.sqlite.backup

# 백업 복원
cp database.sqlite.backup database.sqlite
```

백업과 복원은 쓰기 작업이 없는 상태에서 진행하는 것이 안전합니다. `*.sqlite`, `.env` 등 운영 데이터와 비밀 정보는 `.gitignore`에 포함되어 있습니다.

보스 참여 이력은 발생 시각 기준 기본 90일 동안 보존되며, 서버가 시작될 때와 하루에 한 번 오래된 일정·참여 데이터를 자동 정리합니다. 보존 기간을 바꾸려면 `BOSS_HISTORY_RETENTION_DAYS` 환경변수를 지정하세요.

### 아이템 현황 V2 마이그레이션

V2는 기존 `user_collections` 데이터를 삭제하지 않고 고정 `collection_item_id` 기반 테이블로 복사합니다. 새 코드를 처음 실행하면 마이그레이션이 한 번만 자동 실행됩니다.

```bash
# 서버를 중지하고 반드시 백업
npx pm2 stop odin-guild-manager
cp database.sqlite database.sqlite.before-collections-v2

# 새 코드 설치 후 최초 실행
npm ci --omit=dev
npx pm2 restart odin-guild-manager

# 기존 데이터와 V2 데이터의 누락 여부 검사
npm run audit:collection-migration
```

검사 결과에서 `unmatchedLegacyChecks`와 `orphanV2Checks`가 모두 `0`이어야 합니다. 문제가 있으면 서버를 다시 중지한 뒤 백업 파일을 `database.sqlite`로 복원할 수 있습니다.

## PM2로 운영하기

```bash
JWT_SECRET='충분히-길고-무작위인-비밀키' \
PORT=3000 \
npx pm2 start server.js --name odin-boss-schedule

npx pm2 status
npx pm2 logs odin-boss-schedule
```

서버 재부팅 후 자동 실행이 필요하면 PM2의 `startup`과 `save` 설정을 추가하세요.

## 프로젝트 구조

```text
.
├── server.js              # Express API, SQLite 초기화, Discord 봇
├── app.js                 # 보스 스케줄 화면 로직
├── boss_vote.js           # 보스 참여 투표 로직
├── styles.css             # 공통 애플리케이션 스타일
├── auth.css               # 로그인·가입·프로필 화면 스타일
├── collections_data.js    # 초기 아이템 컬렉션 데이터
├── login.html             # 로그인
├── menu.html              # 메인 메뉴
├── boss_schedule.html     # 보스 스케줄
├── boss_vote.html         # 보스 참여 투표
├── notice.html            # 공지·가격표·보스 통제
├── support.html           # 손지원 매칭
├── janken.html            # 짱깸보 아이템 추첨
├── janken.js              # 짱깸보 명단 지정·추첨 화면 로직
├── collections.html       # 아이템 컬렉션 현황
├── content.html           # 콘텐츠 그룹 빌더
├── siege.html             # 공성전 참여 현황
├── members.html           # 길드원 관리
├── settings.html          # 길드·Discord·가입 링크 설정
├── edit_profile.html      # 내 정보 수정
└── register.html          # 초대 링크 기반 회원가입
```

## 운영 전 확인 사항

- 기본 길드장 비밀번호를 즉시 변경하세요.
- 기본값 대신 강력한 `JWT_SECRET`을 지정하세요. 서버를 재시작할 때도 같은 값을 유지해야 기존 로그인 토큰이 유효합니다.
- Discord 봇 토큰과 `database.sqlite`를 저장소에 커밋하지 마세요.
- 외부에 공개할 경우 HTTPS를 적용하고 신뢰할 수 있는 리버스 프록시 뒤에서 운영하세요.
- SQLite 파일을 정기적으로 백업하세요.
