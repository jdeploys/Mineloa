# Nnote Mac App Store 등록 가이드

> 기준: Nnote 0.0.1, Electron 43, electron-builder 26, 2026-07-17

## 먼저 결론

현재 `npm run package:mac`으로 만드는 DMG는 **Mac App Store 제출용 빌드가 아니다.** 지금 설정은 App Store 밖에서 배포하는 일반 macOS 앱을 만들며, 대상도 `dmg`와 `dir`이다.

Mac App Store판은 다음을 별도로 준비해야 한다.

1. Electron의 `mas` 빌드 사용
2. App Sandbox용 entitlements와 provisioning profile 적용
3. 앱과 모든 helper/네이티브 실행 파일 서명
4. 실제 Mac에서 샌드박스판 기능 검증
5. App Store Connect에 앱 정보와 개인정보 답변 등록
6. Transporter 등으로 빌드 업로드 후 심사 제출

기존 DMG 배포 설정은 유지하고, `mas` 전용 설정과 스크립트를 분리하는 방식을 권장한다. 두 배포 방식은 인증서, Electron 바이너리, 권한, 실행 가능 기능이 다르다.

## 현재 저장소의 준비 상태

| 항목 | 현재 상태 | App Store판에서 필요한 조치 |
| --- | --- | --- |
| Bundle ID | `com.jdeploys.nnote` | Apple Developer와 App Store Connect에 같은 explicit App ID 생성 |
| 버전 | `0.0.1` | 마케팅 버전으로 사용 가능. 업로드마다 고유한 build number 추가 |
| macOS 대상 | `dmg`, `dir` | 별도 `mas` 대상 추가 |
| Sandbox | 없음 | `com.apple.security.app-sandbox` 활성화 |
| 마이크 | 사용 설명문과 audio-input entitlement 존재 | MAS entitlements에서도 유지하고 실제 권한 요청 검증 |
| OpenAI API | 외부 HTTPS 통신 | `com.apple.security.network.client` 필요 |
| `.nnote`/Markdown 파일 | 열기·저장 대화상자 사용 | user-selected file read/write entitlement 필요 |
| 로컬 Whisper/FFmpeg | 앱 번들에 실행 파일 포함, 현재 mac 설정에서 `signIgnore` | MAS판에서는 제외 서명하면 안 됨. child entitlement를 적용해 모두 서명·실행 검증 |
| Whisper 모델 | 실행 중 Hugging Face에서 데이터 파일 다운로드 | 네트워크/저장 경로/심사 설명 검증. 실행 코드를 내려받지 않도록 유지 |
| Codex CLI | 사용자의 전역 `codex` 명령을 탐색해 별도 프로세스로 실행 | 샌드박스에서 그대로 동작한다고 가정할 수 없음. MAS판 비활성화 또는 별도 적합성 검증 필요 |
| 자동 업데이트 | 없음 | MAS판은 App Store 업데이트만 사용 |

## 가장 큰 제품 결정: 로컬 고급 기능

Nnote의 기본 OpenAI API 경로는 App Store판과 비교적 잘 맞는다. 반면 로컬 고급 기능은 각각 다르게 다뤄야 한다.

### 번들 Whisper와 FFmpeg

`whisper-cli`와 `ffmpeg`는 Nnote가 소유한 앱 번들 안에 들어가므로, 모든 바이너리를 올바르게 서명하고 샌드박스 권한을 상속시키면 유지할 여지가 있다. 현재 `package.json`의 `mac.signIgnore`는 일반 DMG용 설정이므로 MAS 설정에서는 사용하지 말아야 한다.

반드시 확인할 것:

- 두 실행 파일이 `Nnote.app/Contents/Resources/local-runtime/...` 안에 포함되는가
- 두 실행 파일과 관련 동적 라이브러리가 모두 서명되었는가
- child entitlements에 `app-sandbox`와 `inherit`가 적용되는가
- 샌드박스 안에서 임시 오디오 변환과 전사가 끝까지 성공하는가
- 앱 종료 시 자식 프로세스가 남지 않는가
- 제3자 라이선스 고지가 앱 번들에 포함되는가

### 다운로드하는 Whisper 모델

모델 `.bin`은 실행 코드가 아니라 데이터로 취급하는 설계를 유지한다. 앱 컨테이너의 Application Support 영역에만 저장하고, 다운로드 URL·용량·용도를 UI와 심사 노트에 명확히 적는다. 모델 다운로드가 앱 기능을 심사 시점과 크게 다르게 만들지 않는지도 확인해야 한다.

### 외부 Codex CLI

현재 구현은 사용자가 별도로 설치한 전역 `codex` 실행 파일과 로그인 정보를 찾는다. App Sandbox는 앱 밖의 실행 파일과 설정 접근을 제한하므로 **MAS판에서 현재 방식이 동작할 가능성은 낮다는 추론**이 합리적이다. 또한 사용자가 추가 실행 코드를 설치해야만 기능이 생기는 흐름은 심사 설명이 까다롭다.

첫 제출에서는 다음 중 하나를 권장한다.

1. **권장:** MAS판에서 Codex CLI 공급자를 숨기고 OpenAI API 또는 번들 로컬 Whisper만 제공
2. 별도 실험 빌드에서 sandbox extension, 파일 접근, 프로세스 실행, 인증 파일 접근을 모두 검증한 뒤 심사 노트와 함께 제공

일반 DMG판에는 Codex CLI 기능을 그대로 유지할 수 있다. 빌드 채널별 capability로 분리하고 UI에 흩어진 `if/else` 대신 provider descriptor에서 가용성을 선언하는 현재 어댑터 구조를 유지한다.

## 1. Apple 계정과 식별자 준비

- Apple Developer Program에 가입한다.
- Xcode의 Accounts에서 팀을 추가한다.
- Certificates, Identifiers & Profiles에서 `com.jdeploys.nnote` explicit App ID를 만든다.
- App Store Connect에서 macOS 앱 레코드를 만들고 같은 Bundle ID를 선택한다.
- 앱 이름 `Nnote`, SKU, 기본 언어를 정한다.

Bundle ID는 첫 업로드 전 확정하는 것이 좋다. 바꾸려면 코드 서명, 프로비저닝, App Store Connect 레코드가 모두 함께 바뀐다.

## 2. 인증서와 프로비저닝 준비

Xcode에서 다음 인증서를 만든다.

- `Apple Development`: 등록된 개발 Mac에서 샌드박스 앱을 직접 실행하고 검사할 때 사용
- `Apple Distribution`: App Store 제출 빌드 서명에 사용

그리고 다음 profile을 준비한다.

- 개발 테스트용 Mac App Development profile: 테스트할 Mac의 Device ID 포함
- 제출용 Mac App Store Connect profile: `com.jdeploys.nnote`에 연결

Apple Distribution으로 서명한 제출판은 Apple이 다시 서명하기 전에는 일반 앱처럼 직접 실행해 테스트하는 대상이 아니다. 로컬 검증은 Apple Development 인증서와 개발용 provisioning profile로 한다.

## 3. MAS 전용 빌드 설정 만들기

일반 DMG 설정을 덮어쓰지 말고 다음 파일을 분리하는 것을 권장한다.

```text
build/
  entitlements.mac.plist          # 기존 일반 배포판
  entitlements.mas.plist          # MAS 앱 본체
  entitlements.mas.inherit.plist  # Electron helper와 번들 실행 파일
electron-builder.mas.yml          # MAS 전용 electron-builder 설정
```

앱 본체의 최소 방향은 다음과 같다. 실제 Team ID와 application group 값은 Apple 계정에 맞춰야 한다.

```xml
<dict>
  <key>com.apple.security.app-sandbox</key>
  <true/>
  <key>com.apple.security.device.audio-input</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>
</dict>
```

child/helper용 파일의 기본 방향:

```xml
<dict>
  <key>com.apple.security.app-sandbox</key>
  <true/>
  <key>com.apple.security.inherit</key>
  <true/>
</dict>
```

MAS 전용 electron-builder 설정에는 적어도 다음 의도가 드러나야 한다.

- target: `mas`
- identity: Apple Development 또는 Apple Distribution을 환경별로 주입
- provisioning profile 주입
- `entitlements.mas.plist`와 `entitlements.mas.inherit.plist` 지정
- `ElectronTeamID` 확인
- `signIgnore`로 Whisper/FFmpeg를 제외하지 않음
- arm64/x64 중 실제 지원 아키텍처를 명시

인증서 이름, Team ID, profile 경로를 저장소에 하드코딩하지 않는다. `.p12`와 비밀번호, App Store Connect API key도 커밋하지 않는다.

## 4. 샌드박스 파일 접근 정리

Nnote는 다음 파일 흐름을 실제 MAS 개발 빌드에서 확인해야 한다.

- `.nnote` 가져오기: `dialog.showOpenDialog`
- `.nnote` 내보내기: `dialog.showSaveDialog`
- Markdown 내보내기: `dialog.showSaveDialog`
- 복구 오디오 내보내기: `dialog.showSaveDialog`
- SQLite, 설정, Whisper 모델: Electron `userData` 아래 앱 컨테이너 내부
- 녹음/전사 임시 파일: 컨테이너가 허용하는 임시 디렉터리

사용자가 대화상자에서 고른 경로는 그 작업 동안 접근할 수 있어야 한다. 앱 재실행 후에도 같은 외부 경로를 자동으로 다시 열어야 한다면 security-scoped bookmark 설계가 추가로 필요하다. 현재처럼 매번 대화상자로 고르는 import/export는 먼저 user-selected read/write entitlement로 검증한다.

## 5. 실제 Mac에서 개발 서명판 검증

Windows에서 TypeScript 빌드가 성공하는 것만으로 MAS 호환성을 확인할 수 없다. 최소 한 대의 실제 Mac에서 다음을 수행한다.

1. Apple Development 인증서와 개발용 profile로 `mas` 빌드
2. `codesign --verify --deep --strict --verbose=2 Nnote.app`
3. `codesign -d --entitlements :- Nnote.app`로 본체 entitlement 확인
4. `codesign -d --entitlements :-`로 Electron Helper, `whisper-cli`, `ffmpeg`도 확인
5. Console에서 `sandboxd` 거부 로그 확인
6. 아래 기능 체크리스트를 처음부터 끝까지 실행

기능 체크리스트:

- [ ] 최초 실행
- [ ] 마이크 권한 허용/거부 후 재시도
- [ ] 녹음 시작, 일시정지, 재개, 중지, 폐기
- [ ] OpenAI API 키 저장/삭제와 전사·요약
- [ ] Whisper 모델 다운로드/삭제
- [ ] 로컬 Whisper 전사와 FFmpeg 변환
- [ ] `.nnote` 가져오기/내보내기
- [ ] Markdown 및 복구 파일 내보내기
- [ ] 앱 재시작 후 회의·설정 유지
- [ ] 오프라인 상태의 로컬 기록 열람
- [ ] 다크/라이트 테마와 모든 주요 화면
- [ ] 앱 종료 뒤 child process가 남지 않음

## 6. App Store Connect 메타데이터

다음 자료를 준비한다.

- 앱 이름, 부제, 설명, 키워드, 카테고리
- 지원 URL과 공개 개인정보 처리방침 URL
- App Privacy 답변: 녹음, 전사문, API 전송, 로컬 저장 방식을 실제 동작과 일치시킴
- macOS 스크린샷: 현재 규격은 제출 직전에 App Store Connect 도움말에서 다시 확인
- 앱 아이콘
- 연령 등급
- 가격과 배포 국가
- 암호화 수출 규정 답변
- 심사 연락처

심사 노트에는 다음을 구체적으로 쓴다.

- 로그인 없이 로컬 녹음과 기록 관리가 가능함
- OpenAI API 기능은 사용자가 자신의 API key를 입력해야 함
- 어떤 데이터가 OpenAI로 전송되는지
- 로컬 Whisper 모델 다운로드 위치, 용도, 크기
- 마이크 권한이 필요한 이유와 재현 절차
- 샘플 회의 생성 또는 전체 기능 테스트 절차
- MAS판에서 Codex CLI를 뺐다면 일반 DMG판과 기능이 다른 이유

숨겨진 고급 기능도 심사 노트에서 빠뜨리지 않는다.

## 7. 업로드와 심사 제출

1. `0.0.1` 마케팅 버전과 고유한 build number로 Apple Distribution 빌드를 만든다.
2. 서명·entitlements·provisioning profile을 검사한다.
3. Transporter 또는 Apple이 지원하는 업로드 도구로 App Store Connect에 올린다.
4. 처리 완료 메일을 기다리고 빌드 경고를 확인한다.
5. 가능하면 TestFlight 내부 테스트로 설치판을 다시 확인한다.
6. 메타데이터, App Privacy, 심사 노트를 완성한다.
7. 해당 빌드를 선택해 App Review에 제출한다.

App Store Connect는 bundle ID와 version으로 업로드 빌드를 앱/버전에 연결하고, build string으로 각 빌드를 구분한다. 재업로드할 때는 build number를 반드시 올린다.

## 첫 제출 전 차단 항목

아래 네 가지가 끝나기 전에는 “MAS 제출 가능”으로 보지 않는다.

- [ ] `mas` 빌드와 App Sandbox 전용 설정 구현
- [ ] Whisper/FFmpeg 포함 바이너리 전체 서명 및 실제 Mac 실행 성공
- [ ] Codex CLI를 MAS판에서 제외하거나 샌드박스 호환성을 입증
- [ ] import/export, 모델 다운로드, OpenAI 통신의 sandbox 거부 로그가 없음

## 권장 작업 순서

1. MAS판에서 Codex CLI를 비활성화하는 capability 결정
2. `mas` 전용 builder/entitlements 파일 추가
3. Apple Development 서명으로 arm64 개발 빌드 생성
4. M1~M3 실제 Mac에서 전체 기능과 sandbox 로그 검증
5. x64 지원이 필요하면 Intel Mac 또는 적절한 테스트 환경에서 별도 검증
6. 개인정보 처리방침과 App Store 메타데이터 작성
7. Apple Distribution 빌드 업로드 및 TestFlight 검증
8. 심사 제출

## 공식 문서

- [Electron: Mac App Store Submission Guide](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide/)
- [Apple: Protecting user data with App Sandbox](https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox)
- [Apple: Configuring the macOS App Sandbox](https://developer.apple.com/documentation/xcode/configuring-the-macos-app-sandbox)
- [Apple: Accessing files from the macOS App Sandbox](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)
- [Apple: Create an App Store provisioning profile](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/)
- [Apple: Certificates overview](https://developer.apple.com/help/account/certificates/certificates-overview)
- [Apple: Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
- [Apple: Upload app previews and screenshots](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots)
- [Apple: App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
