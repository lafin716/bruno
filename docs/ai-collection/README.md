# 로컬 구독 AI로 Swagger 컬렉션 만들기

## 사용 순서

1. 로컬 Codex CLI 또는 Claude Code CLI를 설치하고 구독 계정으로 로그인합니다. Codex는 `codex login`, Claude Code는 `claude auth login`을 사용합니다.
2. Bruno에서 **Preferences → AI → Configuration**의 AI 기능을 켭니다.
3. **Local CLI**에서 Codex 또는 Claude Code를 활성화합니다. 실행 파일 경로를 지정하고 **Check connection**으로 설치 버전과 구독 로그인 상태를 확인합니다. 모델 입력이 비어 있으면 CLI 기본 모델을 사용합니다.
4. 컬렉션의 **+ → Import Collection → AI**로 이동합니다. Swagger UI 링크 또는 OpenAPI JSON/YAML 링크를 입력하고 제공자를 선택합니다.
5. **Generate collection**을 누르면 API 구조를 읽고 AI가 폴더와 문서에 정의된 토큰 추출 경로를 제안합니다. 결과와 안내를 확인합니다. **Cancel**, 탭 이동, 창 닫기는 진행 중 작업을 중지합니다.
6. **Choose location → Import**로 저장합니다. 생성만으로 기존 컬렉션이나 파일을 변경하지 않습니다.
7. 생성된 환경을 선택하고 필요한 인증 변수를 채웁니다. 로그인 요청을 보내면 성공 응답의 토큰을 `bru.setVar`로 런타임 변수에 담아 후속 요청에 사용할 수 있습니다. 실제 인증 요청은 가져오기 중에 보내지 않습니다.

## 동작과 지원 범위

기존 API 키 방식의 AI 설정과 일반 가져오기는 그대로 사용할 수 있습니다. 로컬 연결은 이 컬렉션 자동화 기능에서 사용합니다. CLI의 기존 구독 로그인을 이용하므로 Bruno에 서비스 API 키를 추가하지 않아도 됩니다. 구독의 모델 접근 및 사용 한도는 해당 CLI 계정에 따릅니다.

Swagger 2.0과 OpenAPI 3.x의 JSON/YAML, Swagger UI의 `url`/`configUrl`/initializer 및 일반 문서 위치를 탐색합니다. 상대 서버 주소, 서버별 환경, 선언된 인증과 공개 엔드포인트를 보존합니다. 토큰 경로를 문서에서 확인할 수 없으면 안내를 표시하고 해당 후처리를 생성하지 않습니다. 외부 파일 `$ref`, 해석 불가능한 `$ref`, 변환기가 지원하지 않는 path-item/operation `$ref`, 비표준 동적 Swagger 페이지는 명확한 오류로 안내합니다. 외부 참조는 하나의 OpenAPI 파일로 번들한 뒤 가져올 수 있습니다.

앱에 포함된 [전용 스킬](../../packages/bruno-electron/src/ipc/ai/skills/openapi-collection/SKILL.md)을 프롬프트로 로드합니다. 전역 Codex/Claude 설정이나 스킬을 변경하지 않습니다. API의 구조 요약을 CLI의 AI 서비스에 전송하며 예제와 기본값의 실제 값은 포함하지 않습니다. CLI 인증 파일을 읽어 복사하거나 Bruno에 보관하지 않습니다. 모델이 반환한 임의의 코드를 실행하지 않고 검증된 JSON 계획으로 기존 변환기를 적용합니다.

## 연결 문제 해결

- **실행 파일을 찾을 수 없음:** 터미널의 `command -v codex` 또는 `command -v claude`로 확인한 절대 경로를 입력합니다. 데스크톱에서 실행한 Bruno의 PATH가 터미널과 다를 수 있습니다.
- **로그인 필요/API 방식 로그인:** 같은 CLI로 위 로그인 명령을 실행해 구독 계정으로 로그인합니다. 연결 확인은 모델 요청 없이 로그인 상태를 검사합니다.
- **지원하지 않는 옵션:** 사용 중인 CLI를 업데이트합니다. 이 구현의 검증 버전은 Codex 0.157.1 / Claude Code 2.1.283입니다.
- **Windows:** `.cmd`/`.bat` 런처 대신 네이티브 실행 파일 또는 CLI의 Node `.js`/`.cjs`/`.mjs` 진입점 경로를 지정합니다.
- **문서 탐색 실패:** Swagger 페이지 대신 원본 JSON/YAML 주소를 입력합니다. 인증이 필요한 문서는 현재 링크 가져오기에서 로그인하지 않습니다.
- **큰 문서/시간 초과:** 문서 응답은 5 MiB, 구조 프롬프트는 512 KiB, CLI 응답은 스트림별 2 MiB로 제한됩니다. 문서 탐색은 30초, 모델 실행은 180초입니다.

## 로컬 개발과 검증

저장소 기준 Node 22를 사용합니다. 의존성 설치 후 common/converters/schema-types/filestore/sqlite/requests/query/graphql-docs와 bruno-js sandbox 라이브러리를 빌드합니다. 자세한 기본 개발 안내는 [contributing.md](../../contributing.md)를 따릅니다.

```sh
npm run dev:web
npm run dev:electron

npm run test:ci --workspace=packages/bruno-electron -- --watchman=false --runInBand src/ipc/ai/local-cli.spec.js src/ipc/ai/local.spec.js src/ipc/ai/swagger-resolver.spec.js src/ipc/ai/collection-import.spec.js
npm test --workspace=packages/bruno-app -- --watchman=false --runInBand src/components/Preferences/AI/index.spec.js src/components/Sidebar/ImportCollection/AiTab.spec.js
npx playwright test tests/ai/local-collection-import.spec.ts --project=default --workers=1
npm run build:web
```

Electron smoke 테스트는 임시 CLI와 HTTP 서버, 격리된 사용자 데이터로 실행하며 유료 모델을 호출하지 않습니다. 실제 구독 CLI 호출 결과와 최종 검증 기록은 [VALIDATION.md](VALIDATION.md)에 구분해서 남깁니다. 데스크톱 기능이므로 외부 서비스 배포는 필요하지 않습니다.

## 공식 CLI 근거

- [Codex 비대화형 실행](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex CLI 참조](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [Claude Code CLI 참조](https://code.claude.com/docs/en/cli-reference)
- [Claude Code headless 실행](https://code.claude.com/docs/en/headless)

Codex는 읽기 전용 sandbox와 shell/hooks/plugins/multi-agent 제한으로 호출합니다. Claude Code는 safe mode와 빈 tools/MCP 설정을 사용합니다. Claude의 `--bare`는 구독 OAuth 로그인을 사용하지 않으므로 적용하지 않습니다. 임시 작업 폴더와 세션 비저장 옵션을 사용하지만 CLI 인증 갱신·캐시는 CLI가 관리합니다.
