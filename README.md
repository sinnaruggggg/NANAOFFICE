# NANAOFFICE

한글, PDF, 워드, 스프레드시트, 프레젠테이션과 텍스트 파일을 인터넷 연결 없이 열고 편집할 수 있는 한국어 프로그램입니다.

## 설치

- **Windows 10/11 x64**에서 [GitHub Releases](../../releases)의 `NANAOFFICE-Setup-…-x64.msi`를 실행합니다. 설치 마법사와 편집 화면은 한국어로 표시됩니다. 설치 파일에 오피스 편집기가 포함되어 있습니다. 처음 오피스 문서를 열 때 설치 파일에 포함된 편집기의 압축을 풉니다.
- **Android 9 이상**에 [Android 릴리스](../../releases/tag/v0.5.0)의 `NANAOFFICE-…-android.apk`를 설치합니다. 기기 설정에서 APK를 연 앱에 설치를 허용하라는 안내가 표시될 수 있습니다. 최신 Android System WebView를 권장합니다.

## 파일 작업

| 형식 | NANAOFFICE 내장 편집 기능 |
| --- | --- |
| HWP 5.0 · HWPX | 쪽 미리보기, 일반 본문 문단 수정, 같은 형식으로 사본 저장 |
| PDF | 쪽 미리보기, 90° 회전, 원하는 위치에 메모 추가, PDF 사본 저장 |
| DOCX | 본문 텍스트 수정, DOCX 사본 저장 |
| XLSX | 시트 이동, 텍스트·숫자 셀 값 편집, XLSX 사본 저장 |
| CSV · TSV | 셀 값 수정, 구분 문자에 맞춰 사본 저장 |
| PPTX | 슬라이드 직접 편집, 두 손가락 확대·이동, 개체 드래그 및 모서리 크기 조절, 텍스트 상자·도형·이미지 삽입, 슬라이드 추가·복제·순서 변경·삭제, 전체 화면 슬라이드 쇼 |
| TXT · MD | 원문 편집, UTF-8 사본 저장 |

새 한글 문서는 HWPX로 만들며, 새 한글 문서와 HWP에는 본문 문단을 추가할 수 있습니다. HWP/HWPX의 표·개체 편집, 암호 문서, XLSX의 수식 편집·재계산은 공통 편집 화면의 지원 범위에 포함되지 않습니다. PPTX의 일부 글꼴·차트·복합 개체는 다르게 보일 수 있습니다. 슬라이드 쇼는 슬라이드를 수동으로 넘기는 방식으로, 애니메이션·전환 효과 및 삽입 영상 재생은 지원 범위에 포함되지 않습니다.

Android의 PPTX 화면에서 **PC 모드**를 누르면 리본·왼쪽 썸네일·캔버스 구성을 사용합니다. **터치 모드**로 돌아가면 썸네일 목록을 접고 캔버스가 화면 폭을 사용합니다. 두 모드에서 글자를 두 번 눌러 슬라이드 위에서 편집합니다. 마우스와 키보드로는 개체를 선택한 뒤 화살표로 이동하거나 F2로 글자를 편집할 수 있습니다. Ctrl+S는 사본 저장을, Ctrl+Z는 실행 취소를 엽니다.

**홈 → 슬라이드 쇼**는 현재 장에서, **슬라이드 → 처음부터 재생**은 첫 장에서 시작합니다. 좌우로 밀거나 방향키를 눌러 장을 넘길 수 있습니다. 숨김 슬라이드는 건너뜁니다.

PDF 메모는 원본 내용 위에 이미지로 저장됩니다. 원래 PDF의 텍스트를 바꾸는 기능과 암호가 설정된 PDF는 이 버전에서 지원하지 않습니다. DOCX는 기존 본문 텍스트를 수정하는 방식입니다. 기존 CP949 또는 UTF-16 텍스트 파일을 수정한 사본은 UTF-8로 저장됩니다. CSV·TSV의 편집 화면은 처음 256개 열을 표시합니다.

Windows에서 DOCX·XLSX·PPTX를 열거나 홈에서 새 워드 문서·스프레드시트·프레젠테이션을 만들면 한국어 ONLYOFFICE 편집 창이 바로 열립니다. 서식, 표·그림, 수식·차트, 발표 기능을 사용할 수 있습니다. **오피스 편집기 열기**는 편집기의 시작 화면을 엽니다. HWP·HWPX, PDF, CSV·TSV, TXT·MD는 NANAOFFICE 내장 편집 기능을 사용합니다.

## 빌드

Node.js 24, JDK 17, Android SDK 36 및 Gradle 8.14.x를 사용했습니다.

```sh
npm ci
npm run build
npm run build:win
```

Android는 동일한 `dist/`를 사용합니다. 앱 ID는 `com.sinnaruggggg.nanaoffice`입니다.

```sh
cd android
gradle :app:assembleRelease
```

릴리스 APK는 Android SDK의 `zipalign`과 `apksigner`로 정렬·서명합니다. 후속 버전으로 업데이트를 제공할 때는 같은 서명 키를 사용하세요.

## 사용한 프로젝트

- HWP/HWPX 처리 및 렌더링은 Edward Kim과 기여자들의 [rhwp](https://github.com/edwardkim/rhwp) 0.9.1을 사용합니다. MIT 라이선스와 각 구성요소 고지는 [라이선스 폴더](public/licenses/rhwp)에 있습니다.
- ZIP 처리는 [fflate](https://github.com/101arrowz/fflate)를 사용합니다. [라이선스](public/licenses/fflate.txt)
- PDF 표시와 저장에는 [PDF.js](https://github.com/mozilla/pdf.js)와 [pdf-lib](https://github.com/Hopding/pdf-lib)를 사용합니다. PDF.js 라이선스는 배포물의 `pdf-assets/`에 포함됩니다. [pdf-lib 라이선스](public/licenses/pdf-lib.md)
- PPTX 표시와 편집에는 [Office Kit PPTX](https://github.com/office-kit/pptx)와 PPTX Preview를 사용합니다. [라이선스](public/licenses/office-kit-pptx.txt)
- Windows 기반은 [Electron](https://github.com/electron/electron)입니다. 라이선스와 Chromium 고지는 Windows 배포물에 포함됩니다.
- Windows의 DOCX·XLSX·PPTX 편집에는 [ONLYOFFICE Desktop Editors 10.0.0](https://github.com/ONLYOFFICE/DesktopEditors/releases/tag/v10.0.0) 공식 배포본을 사용합니다. [라이선스와 대응 소스](desktop/resources/ONLYOFFICE-SOURCES.md)
