# Nnote Electron 회의 녹음기 설계

## 1. 목적

Nnote는 Windows와 macOS에서 동작하는 개인용 로컬 회의 녹음기다. 사용자는 노트북 마이크로 최대 2시간의 오프라인 회의를 녹음하고, 자신의 OpenAI API 키로 화자 분리 전사와 구조화된 회의 요약을 생성한다.

앱은 공개 웹 서비스가 아니다. 회원가입, 로그인, 클라우드 서버 없이 각 기기에서 독립적으로 실행한다. 녹음, 전사, 요약, 설정은 로컬에 저장하며 AI 처리를 요청한 오디오만 OpenAI API로 전송한다.

## 2. 확정된 범위

### 포함

- Electron 기반 Windows 및 macOS 데스크톱 앱
- 노트북 마이크를 이용한 오프라인 회의 녹음
- 최대 2시간 녹음
- 10초 단위 Opus/WebM 청크의 즉시 로컬 저장
- 비정상 종료 후 녹음 복구
- OpenAI 화자 분리 전사
- 전사 후 구조화 요약, 결정사항, 할 일, 주요 논의 생성
- 화자 이름 수동 변경과 결과 전체 반영
- 기본 요약 템플릿과 재사용 가능한 사용자 템플릿
- 회의별 원본 오디오 보관 또는 처리 후 삭제
- 회의 단위 내보내기와 가져오기
- OS 보안 저장소를 통한 OpenAI API 키 보관

### 제외

- PWA와 웹 호스팅
- 모바일 앱과 잠금 화면·백그라운드 녹음
- 온라인 회의 탭 오디오 캡처
- 실시간 전사와 실시간 자막
- 회원가입, Google 로그인, 다중 사용자
- 클라우드 동기화와 기기간 자동 동기화
- 외부 오디오 파일 가져오기
- FFmpeg 및 범용 오디오 변환
- Linux 지원
- 자동 화자 실명 식별과 음성 지문 등록

## 3. 기술 구조

애플리케이션은 Electron의 Main, Preload, Renderer 세 경계로 나눈다. 별도 localhost 서버나 열린 네트워크 포트는 사용하지 않는다.

### Renderer

React와 TypeScript로 화면을 구성한다. 녹음 제어, 대시보드, 기록 상세, 템플릿 편집, 설정을 담당한다. Node.js, 파일시스템, SQLite, OS 자격 증명, OpenAI API 키에는 직접 접근하지 않는다.

Chromium의 `MediaRecorder`로 `audio/webm;codecs=opus`를 녹음한다. 목표 비트레이트는 음성용 20~24kbps이며 실제 파일 크기를 신뢰 기준으로 사용한다.

### Preload

Renderer에 필요한 최소 기능만 타입이 정의된 IPC API로 노출한다. 대표 인터페이스는 다음과 같다.

- `recording.start`, `recording.appendChunk`, `recording.pause`, `recording.resume`, `recording.stop`, `recording.discard`
- `meetings.list`, `meetings.get`, `meetings.update`, `meetings.process`, `meetings.retry`, `meetings.delete`
- `speakers.rename`
- `templates.list`, `templates.create`, `templates.update`, `templates.delete`
- `settings.setApiKey`, `settings.validateApiKey`, `settings.deleteApiKey`
- `archive.export`, `archive.import`

IPC 입력은 Main에서 다시 검증한다. Renderer가 임의 파일 경로, 셸 명령, 원시 SQL, API 키 읽기 기능을 요청할 수 있는 범용 IPC는 만들지 않는다.

### Main

Main 프로세스는 로컬 백엔드 역할을 한다.

- SQLite 트랜잭션과 마이그레이션
- 녹음 세션과 오디오 파일 수명 주기
- OS 자격 증명 저장소 접근
- OpenAI 전사 및 요약 호출
- 내보내기·가져오기 패키지 검증
- 앱 시작 시 미완료 녹음 및 작업 복구

`contextIsolation`은 활성화하고 `nodeIntegration`은 비활성화한다. 모든 외부 탐색, 새 창, 권한 요청은 명시적 허용 목록으로 제한한다.

## 4. 로컬 저장 구조

앱 데이터 루트는 Electron의 운영체제별 `userData` 경로를 사용한다.

```text
userData/
  nnote.sqlite
  recordings/
    <meeting-id>.webm
    <meeting-id>.webm.part
    <meeting-id>.session.json
  exports/
  logs/
```

SQLite는 회의 메타데이터, 처리 상태, 전사 구간, 화자 매핑, 요약 결과, 템플릿, 오류 정보를 저장한다. 오디오 바이너리는 SQLite에 넣지 않고 파일로 보관한다.

핵심 엔터티는 다음과 같다.

- `Meeting`: 제목, 생성 시각, 길이, 상태, 오디오 보관 정책, 파일 정보, 선택 템플릿
- `TranscriptSegment`: 화자 ID, 시작·종료 시간, 원문
- `Speaker`: 안정적인 내부 ID와 사용자가 지정한 표시 이름
- `SummarySection`: 템플릿 섹션 ID, 종류, 구조화된 내용
- `ActionItem`: 내용, 담당 화자 ID, 기한, 완료 여부
- `SummaryTemplate`: 이름, 정렬된 섹션 정의, 섹션별 프롬프트
- `ProcessingAttempt`: 단계, 시작·종료 시각, 성공 여부, 안전하게 정제된 오류

API 키는 SQLite, 로그, 내보내기 파일에 저장하지 않는다. `CredentialStore`는 Windows에서 Credential Manager, macOS에서 Keychain을 사용하며 평문 파일 저장 방식으로 대체하지 않는다.

## 5. 녹음 흐름

1. 사용자가 새 회의를 시작한다.
2. Main이 `Meeting`과 복구용 세션 매니페스트를 생성한다.
3. Renderer가 마이크 권한을 얻고 MediaRecorder를 시작한다.
4. 10초마다 생성된 Blob을 IPC로 Main에 전송한다.
5. Main은 순번을 검증한 뒤 임시 파일에 추가하고 매니페스트의 마지막 청크 번호, 누적 바이트, 경과 시간을 원자적으로 갱신한다.
6. 종료 시 마지막 청크를 저장하고 파일을 확정한 뒤 상태를 `recorded`로 변경한다.

전체 녹음을 Renderer 메모리에 보관하지 않는다. 화면 이동, 기록 열기, 설정 진입은 녹음을 취소하지 않는다. 일시정지는 현재 데이터를 보존하고 재개 시 같은 회의에 이어 기록한다. 명시적인 `폐기`만 현재 녹음과 회의 초안을 삭제한다.

누적 크기는 계속 표시한다. 22MB부터 경고하고 24MB에 접근하면 새 녹음 파트로 안전하게 전환한다. 정상적인 2시간 녹음은 목표 비트레이트로 단일 파일이 25MB 미만이 되도록 한다. 파트 전환은 안전장치이며, 발생한 경우 각 파트를 개별 전사하고 파트 경계의 화자 라벨은 사용자 편집 가능한 별도 내부 화자 ID로 유지한다.

## 6. 복구와 상태 전이

정상 상태 전이는 다음과 같다.

```text
draft -> recording -> recorded -> transcribing -> summarizing -> completed
```

`recording` 중 앱이 종료되면 다음 실행에서 `recoverable`로 표시한다. 사용자는 복구, 현재 파일로 보관, 폐기 중 하나를 선택한다. 자동 폐기는 하지 않는다.

AI 처리 실패는 `failed` 상태와 실패 단계를 기록한다. 재시도는 실패 단계부터 시작하며 이미 확정된 앞 단계의 결과를 덮어쓰지 않는다. API 키 오류, 네트워크 오류, 사용량 한도 오류가 발생해도 녹음 파일은 유지한다.

## 7. OpenAI 처리

Main 프로세스만 OS 보안 저장소에서 API 키를 읽고 OpenAI에 요청한다. 키나 Authorization 헤더는 로그와 오류 보고에서 제거한다.

### 전사

- 모델: `gpt-4o-transcribe-diarize`
- 엔드포인트: `/v1/audio/transcriptions`
- 응답 형식: `diarized_json`
- 30초를 넘는 입력: `chunking_strategy: "auto"`
- 입력 언어: 한국어와 영어 자동 감지

OpenAI 공식 문서상 업로드는 25MB로 제한되며, 화자 분리 응답은 화자, 시작 시각, 종료 시각을 포함한다. Nnote는 이 제한을 녹음 중 실제 누적 크기 감시와 24MB 안전 경계로 적용한다.

### 요약

전사 완료 직후 `gpt-5-mini`를 호출해 요약을 생성한다. 첫 버전에서는 모델 선택 UI를 제공하지 않는다. 모델 변경은 앱 릴리스에서 검증된 기본값을 교체하는 방식으로만 수행한다.

요약 결과는 자유 형식 Markdown만 저장하지 않고 구조화된 섹션과 화자 ID를 저장한다. 화자 표시 이름은 렌더링과 내보내기 시점에 해석하므로 이름 변경에 추가 API 호출이 필요 없다.

기본 템플릿의 순서는 다음과 같다.

1. 핵심 요약
2. 결정사항
3. 할 일
4. 주요 논의
5. 화자별 전사

## 8. 요약 템플릿

기본 템플릿은 항상 제공하며 삭제할 수 없다. 사용자는 기본 템플릿을 복제하거나 새 템플릿을 만들 수 있다.

사용자 템플릿은 이름, 정렬된 섹션, 섹션 종류, 섹션별 지시문을 가진다. 섹션 종류는 `paragraph`, `bullet_list`, `action_items`로 제한해 결과 스키마를 검증 가능하게 유지한다. 템플릿은 로컬에 저장되고 회의마다 하나를 선택한다.

## 9. 화면 설계

### 균형형 대시보드

- 왼쪽: 새 회의와 녹음 시작
- 오른쪽: 최근 기록과 처리 상태
- 상단: 전체 기록, 요약 템플릿, 설정

녹음 중에는 경과 시간, 일시정지, 종료, 누적 크기, 마이크 상태, 로컬 저장 상태를 표시한다.

### 단일 문서형 기록 상세

1. 제목, 날짜, 길이, 처리 상태, 오디오 재생
2. 핵심 요약
3. 결정사항
4. 할 일
5. 주요 논의
6. 화자 이름 관리
7. 타임스탬프가 포함된 전체 전사문

전사와 요약은 한 번에 처리한다. 사용자는 처리 후 화자 이름을 변경하며 문서 전체와 Markdown 내보내기에 즉시 반영된다.

## 10. 원본 오디오 수명 주기

회의마다 다음 중 하나를 선택한다.

- `delete_after_processing`: 전사와 요약이 모두 SQLite에 성공적으로 커밋된 뒤 원본 삭제
- `keep`: 사용자가 명시적으로 삭제할 때까지 보관

기본값은 `delete_after_processing`이다. 전사만 성공했거나 요약 저장이 실패한 경우 원본을 삭제하지 않는다. 기존 결과 재처리는 원본이 남아 있을 때만 가능하다.

## 11. 내보내기와 가져오기

회의 하나를 버전이 지정된 `.nnote` ZIP 패키지로 내보낸다.

```text
manifest.json
meeting.json
transcript.json
summary.json
audio.webm  # 원본이 남아 있을 때만 포함
```

API 키, 로그, 로컬 절대 경로는 포함하지 않는다. 가져오기는 매니페스트 버전, JSON 스키마, 압축 해제 크기, 파일 이름과 경로를 검증한다. 기존 ID를 덮어쓰지 않고 새 로컬 ID를 만들어 가져온다. Windows와 macOS가 같은 패키지 형식을 사용한다.

## 12. 오류 처리

- 마이크 권한 거부: 설정 경로와 재시도 제공
- 지원 코덱 없음: 녹음 시작 차단과 명확한 오류 표시
- 저장 공간 부족: 녹음 시작 전 확인 및 녹음 중 쓰기 오류 즉시 표시
- API 키 오류: 설정으로 이동, 녹음 유지
- 네트워크 또는 사용량 제한: 실패 단계 보존과 재시도
- 예상보다 큰 파일: 안전 파트 전환 또는 처리 전 차단
- 손상된 복구 파일: 원본 `.part`를 보존하고 파일로 내보내기 제공
- 잘못된 가져오기 패키지: 아무 데이터도 쓰기 전에 전체 검증

오류 메시지는 사용자 조치와 재시도 가능 여부를 포함한다. 원시 API 응답과 키는 로그에 기록하지 않는다.

## 13. 테스트 전략

### 단위 테스트

- 녹음 및 처리 상태 머신
- 청크 순번, 누적 크기, 22MB 경고, 24MB 파트 전환
- 화자 ID와 표시 이름 해석
- 기본 및 사용자 템플릿 검증
- 내보내기 매니페스트와 경로 검증
- 오류 정제와 비밀 정보 제거

### 통합 테스트

- Preload IPC 허용 목록과 입력 검증
- SQLite와 오디오 파일의 트랜잭션 일관성
- 모의 OS 자격 증명 저장소
- 모의 OpenAI 전사 및 요약 응답
- 비정상 종료 후 세션 복구
- Windows와 macOS 패키지 상호 가져오기

### Electron E2E 및 시각 회귀

- 균형형 대시보드
- 녹음 진행 화면
- 단일 문서형 기록 상세
- 복구 선택 화면
- 마이크 권한 거부와 API 오류 상태

### 짝을 이루는 회귀 테스트

- `delete_after_processing` 성공은 원본을 삭제하고 `keep`은 삭제하지 않는다.
- 명시적 폐기는 녹음을 삭제하고 화면 이동과 앱 종료는 삭제하지 않는다.
- 화자 이름 변경은 표시 결과와 내보내기를 바꾸고 원본 전사 구간과 타임스탬프는 바꾸지 않는다.
- 실패 단계 재시도는 해당 단계만 실행하고 완료된 앞 단계는 덮어쓰지 않는다.
- 사용자 템플릿 삭제는 사용자 템플릿만 제거하고 기본 템플릿은 유지한다.

### 실기기 완료 기준

Windows와 macOS 각각에서 다음을 검증한다.

- 2시간 연속 녹음과 최종 파일 크기
- 녹음 중 강제 종료 후 복구
- 마이크 권한 거부 후 복원
- 네트워크 중단 후 AI 처리 재시도
- API 키 저장, 교체, 삭제
- `.nnote` 패키지의 상호 내보내기와 가져오기
- 설치, 실행, 제거 후 사용자 데이터 보존 정책

## 14. 구현 원칙

- 녹음 유실 방지가 실시간성보다 우선한다.
- 사용자의 명시적 삭제만 파괴적 동작으로 취급한다.
- Renderer는 신뢰 경계 밖으로 보고 모든 IPC를 검증한다.
- API 키와 녹음 파일 경로를 로그에 남기지 않는다.
- FFmpeg는 실제 용량·호환성 검증에서 필요성이 확인되기 전까지 추가하지 않는다.
- 다른 운영체제, 클라우드, 실시간 전사는 별도 설계로 다룬다.

## 15. 공식 참고 자료

- [OpenAI Speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text)
- [GPT-4o Transcribe Diarize](https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize)
- [OpenAI JavaScript SDK browser warning](https://github.com/openai/openai-node/blob/master/README.md)
