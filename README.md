# NANAOFFICE

한글, PDF, 워드, 스프레드시트, 프레젠테이션과 텍스트 파일을 인터넷 연결 없이 열고 편집할 수 있는 한국어 프로그램입니다.

## 설치

- **Windows 10/11 x64**에서 [GitHub Releases](../../releases)의 `NANAOFFICE-Setup-…-x64.msi`를 실행합니다.
- **Android 9 이상**에 같은 릴리스의 `NANAOFFICE-…-android.apk`를 설치합니다. 기기 설정에서 APK를 연 앱에 설치를 허용하라는 안내가 표시될 수 있습니다. 최신 Android System WebView를 권장합니다.

## 파일 작업

| 형식 | Windows·Android 공통 기능 |
| --- | --- |
| HWP 5.0 · HWPX | 쪽 미리보기, 일반 본문 문단 수정, 같은 형식으로 사본 저장 |
| PDF | 쪽 미리보기, 90° 회전, 원하는 위치에 메모 추가, PDF 사본 저장 |
| DOCX | 본문 텍스트 수정, DOCX 사본 저장 |
| XLSX | 시트 이동, 텍스트·숫자 셀 값 편집, XLSX 사본 저장 |
| CSV · TSV | 셀 값 수정, 구분 문자에 맞춰 사본 저장 |
| PPTX | 슬라이드 선택, 기존 텍스트 편집, PPTX 사본 저장 |
| TXT · MD | 원문 편집, UTF-8 사본 저장 |

새 한글 문서는 HWPX로 만들며, 새 한글 문서와 HWP에는 본문 문단을 추가할 수 있습니다. HWP/HWPX의 표·개체 편집, 암호 문서, XLSX의 수식 편집·재계산, PPTX의 도형·슬라이드 추가는 공통 편집 화면의 지원 범위에 포함되지 않습니다.

PDF 메모는 원본 내용 위에 이미지로 저장됩니다. 원래 PDF의 텍스트를 바꾸는 기능과 암호가 설정된 PDF는 이 버전에서 지원하지 않습니다. DOCX는 기존 본문 텍스트를 수정하는 방식입니다. 기존 CP949 또는 UTF-16 텍스트 파일을 수정한 사본은 UTF-8로 저장됩니다. CSV·TSV의 편집 화면은 처음 256개 열을 표시합니다.

Windows의 **ONLYOFFICE에서 열기**는 공식 편집기에서 프레젠테이션과 스프레드시트의 추가 기능을 제공합니다. 첫 사용 시 공식 GitHub 압축본(397 MB)을 내려받거나 이미 설치된 문서 편집실 엔진 캐시를 사용합니다. SHA-256으로 배포본을 확인한 뒤 압축을 풉니다.

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
- Windows 기반은 [Electron](https://github.com/electron/electron)입니다. 라이선스와 Chromium 고지는 Windows 배포물에 포함됩니다.
- 선택형 Windows 고급 편집은 [ONLYOFFICE Desktop Editors 10.0.0](https://github.com/ONLYOFFICE/DesktopEditors/releases/tag/v10.0.0) 공식 배포본을 내려받아 연결합니다. 해당 편집기에는 [AGPL v3와 추가 조항](https://github.com/ONLYOFFICE/DesktopEditors/blob/v10.0.0/LICENSE)이 적용됩니다.
