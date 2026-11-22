#!/usr/bin/env bash
set -euo pipefail

adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell wm size 720x1560
adb shell wm density 360
adb shell am start -W -n com.sinnaruggggg.nanaoffice/.MainActivity

wait_for_ui() {
  local text=$1
  for attempt in $(seq 1 12); do
    if adb shell uiautomator dump /sdcard/nana-ui.xml >/dev/null 2>&1 &&
       adb exec-out cat /sdcard/nana-ui.xml > nana-ui.xml &&
       grep -Fq "$text" nana-ui.xml; then
      return
    fi
    sleep 2
  done
  adb logcat -d -t 150 -s AndroidRuntime chromium
  return 1
}

wait_for_ui 'PDF 열기'
adb exec-out screencap -p > nana-mobile-home.png
read -r x y < <(python3 - <<'PY'
import re
import xml.etree.ElementTree as ET

for node in ET.parse("nana-ui.xml").iter("node"):
    label = node.get("text", "") + " " + node.get("content-desc", "")
    if "텍스트 문서" in label:
        bounds = [int(value) for value in re.findall(r"\d+", node.get("bounds", ""))]
        if len(bounds) == 4:
            print((bounds[0] + bounds[2]) // 2, (bounds[1] + bounds[3]) // 2)
            break
else:
    raise SystemExit("Missing text document button")
PY
)
adb shell input tap "$x" "$y"
wait_for_ui '다른 이름으로 저장'
adb exec-out screencap -p > nana-mobile-editor.png
